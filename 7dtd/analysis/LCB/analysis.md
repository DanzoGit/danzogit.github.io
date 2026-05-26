# Технический анализ 7 Days to Die 2.6 (b14): Спальник, Land Claim и Sleeper Volumes

## 1. Введение

В рамках анализа изучены декомпилированные исходники `Assembly-CSharp.dll` из каталога `_DevFiles/2.6-b14/` и сопутствующие XML-конфигурации из `_DevFiles/Config/`. Все выводы построены исключительно на фактической логике C#-кода (классы и методы) и значениях `GameStats` / `GamePrefs`, считываемых из XML. Локализация и комментарии в `XML.txt` игнорируются как недостоверные.

Ключевые проанализированные компоненты:

- **Спальник**: `BlockSleepingBag`, `MapObjectSleepingBag`, `PersistentPlayerData.BedrollPos`, `EntityBedrollPositionList`.
- **Блок притязания**: `BlockLandClaim`, `TileEntityLandClaim`, `PersistentPlayerList.m_lpBlockMap`, `MapObjectLandClaim`.
- **POI и слиперы**: `Prefab.PrefabSleeperVolume`, `SleeperVolume`, `BlockSleeper`, `TileEntitySleeper`, `SleeperVolumeToolManager`.
- **Общий пайплайн спавна**: `SpawnManagerBiomes`, `World.GetRandomSpawnPositionMinMaxToPosition`, `World.isPositionInRangeOfBedrolls`, `GameUtils.CheckForAnyPlayerHome`.

---

## 2. Технический разбор

### 2.1. Механика спальника (Bedroll)

Спальник — это обычный блок `BlockSleepingBag : Block` (`_DevFiles/2.6-b14/BlockSleepingBag.cs`). Его «уникальность» — это сайд-эффекты при установке и набор записей в персистентных структурах, а не отдельная подсистема.

**Цепочка размещения:**

1. Игрок ставит блок через `ItemActionPlaceAsBlock` → вызывается `block.PlaceBlock(_world, _bpResult, _ea)`.
2. В `BlockSleepingBag.PlaceBlock` производится:
    - проверка `_ea is EntityPlayerLocal` — то есть запись «привязки» делает локальный игрок;
    - `entityPlayerLocal.selectedSpawnPointKey = _ea.entityId` — сохраняется ключ точки респавна;
    - если у блока есть `SiblingBlock` (двойной блок, например двуспальная кровать), вторая часть ставится через `_world.SetBlockRPC(...)` со смещением, заданным `rotationToAddVector(rotation)`.
3. `BlockSleepingBag.CanPlaceBlockAt` дополнительно проверяет, что под обоими блоками (основным и `SiblingBlock`) есть блоки с `blockMaterial.StabilitySupport`, иначе размещение отклоняется.

**Регистрация позиции в мире:**

Регистрация выполняется не самим блоком, а централизованно в `GameManager` при применении изменений мира (`blockChangeInfo`):

```csharp
if (block is BlockSleepingBag || block2 is BlockSleepingBag)
{
    if (block is BlockSleepingBag)
    {
        NavObjectManager.Instance.UnRegisterNavObjectByOwnerEntity(entityAlive, "sleeping_bag");
        entityAlive.SpawnPoints.Set(blockChangeInfo.pos);
    }
    else
    {
        persistentPlayers.SpawnPointRemoved(blockChangeInfo.pos);
    }
}
```

`entityAlive.SpawnPoints` — это `EntityBedrollPositionList`, в `Set(Vector3i)` он делает:

```csharp
data.BedrollPos = _pos;
data.ShowBedrollOnMap();
```

То есть позиция спальника физически живёт в `PersistentPlayerData.BedrollPos` (`Vector3i`). Маркер на карте — это `MapObjectSleepingBag` (`EnumMapObjectType.SleepingBag`), регистрируемый через `NavObjectManager.RegisterNavObject("sleeping_bag", BedrollPos.ToVector3())` в `PersistentPlayerData.ShowBedrollOnMap`.

**Хранение и удаление:**

- Если игрок ставит другой спальник в другом месте, старый автоматически «забывается»: при добавлении нового `BlockSleepingBag` всегда вызывается `SpawnPoints.Set(pos)`, заменяющий `BedrollPos`.
- При сломе блока выполняется `persistentPlayers.SpawnPointRemoved(pos)`. На стороне игрока `EntityPlayerLocal.CheckSpawnPointStillThere` каждую секунду проверяет, что блок на сохранённой позиции действительно `BlockSleepingBag`; если нет — вызывается `RemoveSpawnPoints()` → `selectedSpawnPointKey = -1L` и тултип `ttBedrollGone`.
- Принадлежность определяется через `BlockSleepingBag.GetOwningPlayer(Vector3i)`, который проходит `GameManager.Instance.GetPersistentPlayerList().Players` и сравнивает `BedrollPos.Equals(_blockPos)`.
- В региональных файлах позиции спальников хранятся отдельно: `RegionFileManager.bedrolls : List<Vector3i>`.

Итого: спальник — это связка `BlockSleepingBag` (визуал и валидация) + `PersistentPlayerData.BedrollPos` (логическая регистрация) + `EntityBedrollPositionList` (доступ от лица сущности игрока) + `MapObjectSleepingBag` (карта).

---

### 2.2. Механика блока притязания (Land Claim Block)

Land Claim в коде называется `lpblock` (`Block.IndexName == "lpblock"`). Реализован классом `BlockLandClaim : Block` (`_DevFiles/2.6-b14/BlockLandClaim.cs`).

**Размещение и предварительная проверка:**

В `ItemActionPlaceAsBlock` и `BlockToolSelection` есть отдельная ветка для `lpblock`:

```csharp
if (blockValue.Block.IndexName == "lpblock")
{
    if (!invData.world.CanPlaceLandProtectionBlockAt(_bpResult.blockPos,
            invData.world.gameManager.GetPersistentLocalPlayer()))
    { ... return; }
}
```

`World.CanPlaceLandProtectionBlockAt(Vector3i blockPos, PersistentPlayerData lpRelative)` делает:

1. Если `EnumGameStats.GameModeId != 1` — разрешает всё (creative/тест).
2. Сужает мир: `InBoundsForPlayersPercent(...) >= 0.5f`.
3. Считывает размеры зоны из настроек:
    - `num  = GameStats.GetInt(EnumGameStats.LandClaimSize) - 1` — половина стороны зоны;
    - `num2 = GameStats.GetInt(EnumGameStats.LandClaimDeadZone) + num` — радиус «мёртвой зоны», в которой нельзя ставить второй keystone.
4. Проходит по всем чанкам в радиусе `num2` и для каждого зовёт `IsLandProtectedBlock(chunk, blockPos, lpRelative, num, num2, forKeystone: true)`.
5. Запрещает размещение, если попадание в `IsWithinTraderArea(...)`.

**Сама регистрация:**

`BlockLandClaim.OnBlockAdded`:

```csharp
TileEntityLandClaim te = _world.GetTileEntity(_chunk.ClrIdx, _blockPos) as TileEntityLandClaim;
if (te == null)
{
    var newTe = new TileEntityLandClaim(_chunk) { localChunkPos = World.toBlock(_blockPos) };
    _chunk.AddTileEntity(newTe);
    te = newTe;
}
if (te.IsOwner(PlatformManager.InternalLocalUserIdentifier))
{
    te.BoundsHelper = LandClaimBoundsHelper.GetBoundsHelper(_blockPos.ToVector3());
    te.BoundsHelper.gameObject.SetActive(te.ShowBounds);
}
```

То есть на блок навешивается `TileEntityLandClaim`, в котором хранится `ownerID : PlatformUserIdentifierAbs`, флаг `showBounds`, и (на клиенте владельца) `BoundsHelper` — кубик каркаса.

**Связь с persistent-данными игрока:**

Основная регистрация выполняется в `GameManager` при обработке `blockChangeInfo`:

```csharp
if (persistentPlayerData != null)
{
    persistentPlayers.PlaceLandProtectionBlock(blockChangeInfo.pos, persistentPlayerData);
    ((BlockLandClaim)block).HandleDeactivatingCurrentLandClaims(persistentPlayerData);
    if (BlockLandClaim.IsPrimary(blockChangeInfo.blockValue))
        NavObjectManager.Instance.RegisterNavObject("land_claim", blockChangeInfo.pos.ToVector3());
}
```

То есть позиция блока попадает в `PersistentPlayerList.m_lpBlockMap : Dictionary<Vector3i, PersistentPlayerData>` через `PlaceLandProtectionBlock`. Обратное действие — `RemoveLandProtectionBlock(pos)`, очищающее map и снимающее `NavObject`.

**Отслеживание «зоны действия»:**

Зона никогда не хранится как объект; она считается «на лету» по позиции блока:

- Сторона зоны: `EnumGameStats.LandClaimSize`. Половина — `claimSize = LandClaimSize - 1`.
- Это используется в `World.IsLandProtectedBlock(chunk, blockPos, lpRelative, claimSize, deadZone, forKeystone)`:
    
    ```csharp
    int num  = Math.Abs(pos.x - blockPos.x);
    int num2 = Math.Abs(pos.z - blockPos.z);
    if (num > deadZone || num2 > deadZone) continue;
    ```
    
    Затем берётся владелец через `persistentPlayerList.GetLandProtectionBlockOwner(pos)` и `IsLandProtectionValidForPlayer(owner)`. Учитываются ACL: если игрок есть в `landProtectionBlockOwner.ACL`, защита для него ослабляется (`flag = num <= claimSize && num2 <= claimSize && forKeystone`).
    
- Кандидаты-блоки выбираются по `chunk.IndexedBlocks["lpblock"]` (быстрый индекс позиций «lpblock» в чанке) и фильтруются через `BlockLandClaim.IsPrimary(blockValue)`:
    
    ```csharp
    public static bool IsPrimary(BlockValue _blockValue) => (_blockValue.meta & 2) == 0;
    ```
    
    То есть «активность» (primary/secondary) кодируется битом 2 в `meta` блока. `ServerCheckPrimary(Vector3i)` дополнительно проверяет, что владелец зарегистрирован в `m_lpBlockMap`.
    

**«Активный статус»:**

Активность keystone определяется тремя факторами:

1. Запись в `PersistentPlayerList.m_lpBlockMap` существует;
2. `BlockLandClaim.IsPrimary(...)` (бит meta);
3. Срок «оффлайна» владельца не превышен — это используется не для самого блока, а для модификаторов и игровой логики (см. `GameUtils.CheckForAnyPlayerHome`, ниже). Срок — `EnumGameStats.LandClaimExpiryTime` (в днях, умножается на 24).

Маркер на карте делает `MapObjectLandClaim`, регистрируемый только для primary-блока.

---

### 2.3. Система спавна зомби внутри POI (Sleeper Volumes)

Спавны внутри POI — это не «динамический» спавн биома, а полностью отдельная подсистема `SleeperVolume`.

**Структура данных:**

- В `Prefab` есть список `PrefabSleeperVolume` — это «коробка» внутри POI, заданная в редакторе (`Prefab.PrefabSleeperVolume`, `Prefab.CountSleeperSpawnsInVolume`).
- При создании мира из `PrefabInstance` создаются runtime-объекты `SleeperVolume` и привязываются к чанкам: `Chunk.GetSleeperVolumes() : List<int>`, общий пул — `World.sleeperVolumes`.
- Внутри POI находятся блоки `BlockSleeper : Block` (`_DevFiles/2.6-b14/BlockSleeper.cs`) — это «точки спавна» спящего зомби. У них в `Init()` парсятся свойства XML: `Pose`, `LookIdentity`, `ExcludeWalkType` (например, `Crawler` маппится в walkType `21`), `SpawnGroup`, `SpawnMode` (`BlockSleeper.eMode` со значениями вроде `Bandit`, `Infested`).
- На каждый размещённый sleeper-блок в редакторе POI вызывается `BlockShapeModelEntity.OnBlockLoaded` → `registerSleepers(...)` → `SleeperVolumeToolManager.RegisterSleeperBlock(_bv, prefabTrans, position)` (только в Edit-режиме), а в рантайме блок попадает в `spawnPointList` соответствующего `SleeperVolume` (через `Prefab.CountSleeperSpawnsInVolume`, ищущий все позиции, где `_world.GetBlock(...).Block.IsSleeperBlock` истинно).

**Триггеры активации (`SleeperVolume.ETriggerType`):**

`SleeperVolume` хранит флаги (`flags & 7`) и список индексов триггеров `TriggeredByIndices`. Активация выполняется в двух местах:

1. `World.CheckSleeperVolumeTouching(EntityPlayer)` — каждый кадр для каждого игрока берётся его `GetBlockPosition()`, по чанку получается `chunk.GetSleeperVolumes()`, и для каждого вызывается `sleeperVolumes[num].CheckTouching(this, player)`.
2. `World.CheckSleeperVolumeNoise(Vector3)` — аналогично, но по позиции шума, и зовётся `CheckNoise`. Перед этим проверяется `GameStats.GetBool(EnumGameStats.IsSpawnEnemies)`.

`SleeperVolume.CheckTouching` различает три режима по `ETriggerType`:

- `Attack` / `Trigger` — игрок зашёл в коробку (с паддингом `cAttackPaddingXZ = -0.1f`) → `TouchGroup(_world, _player, setActive: true)`.
- `Passive` — пассивный спавн, заходим в чуть более расширенную коробку (`cPassivePaddingXZ = -0.3f`).
- Помимо этого, `CheckTrigger(World, Vector3 playerPos)` использует расширенные `triggerPaddingMin/Max` и переключает волюм в «начал спавн».

Когда волюм впервые активируется (`!isSpawned`) и игрок в зоне триггера, выполняется `_world.UncullPOI(prefabInstance)` (форсированно «оживить» POI), и затем запускается цикл спавна.

**Алгоритм спавна спящего:**

В `SleeperVolume`:

1. `FindSpawnIndex(World)` берёт случайную позицию из `spawnsAvailable` (индексы в `spawnPointList`), пока не найдёт такую, где:
    - `_world.CanSleeperSpawnAtPos(pos, _checkBelow: true)` — пустое место для тела и под ним есть `Block.IsCollideMovement` (см. `Chunk.CanSleeperSpawnAtPos`);
    - `SpawnPointIsHidden(_world, num3)` — точка не видна игроку (упрощённая проверка).
    
    Если все «обычные» не подошли — фоллбэк `FindFathestSpawnFromPlayers`.
    
2. `CheckSpawnPos(World, Vector3i)` отсекает позиции в незагруженных/копируемых/регенерируемых чанках.
3. По `GameStageGroup.spawner` берётся `GameStageDefinition.Stage stage = ...GetStage(gameStage)` и по нему — конкретная группа спавна (`groupCountList`).
4. `BlockSleeper block2.spawnGroup` (или, если пуст, `stage.GetSpawnGroup(0).groupName`) подставляется в `EntityGroups.GetRandomFromGroup(spawnGroup, ref lastClassId, sleeperRandom)` — оттуда вытаскивается `entityClassId`.
5. `Spawn(World, entityClass, spawnIndex, BlockSleeper)`:
    - Проверка `block.ExcludesWalkType(EntityAlive.GetSpawnWalkType(_value))` — если zomby имеет «несовместимый» walkType (например, Crawler на блоке, исключающем Crawler), спавн отменяется;
    - `EntityFactory.CreateEntity(entityClass, vector, new Vector3(0, spawnPoint.rot, 0))`;
    - Тэги для системы стелса/AI: `entityAlive.SetSpawnerSource(EnumSpawnerSource.Dynamic)`, `IsSleeperPassive = true`, `SleeperSpawnPosition`, `SleeperSpawnLookDir = block.look`, `SetSleeper()`, `TriggerSleeperPose(block.pose)`;
    - `_world.SpawnEntityInWorld(entityAlive)`;
    - Заносится в `respawnMap[entityId] = { className, spawnPointIndex }` для последующего восстановления;
    - Если `playerTouchedTrigger != null`, запускается корутина `WakeAttackLater(...)` (пробуждение и атака).

Также есть отдельный объект `TileEntitySleeper`, хранящий per-зомби параметры стелса (`priorityMultiplier`, `sightAngle`, `sightRange`, `hearingPercent`) — он читается из префаба при сохранении (`BlockSleeper.IsTileEntitySavedInPrefab`).

**Пробуждение и AI:**

`EntityAlive.TriggerSleeperPose(int _pose, bool _returningToSleep = false)` устанавливает `IsSleeping = true`, `SleeperSupressLivingSounds = true`, и через `emodel.avatarController.TriggerSleeperPose(...)` запускает анимацию. Пробуждение делает `ConditionalTriggerSleeperWakeUp()`: `IsSleeping = false`, `IsSleeperPassive = false`, отправляется `NetPackageSleeperWakeup` и `aiManager.SleeperWokeUp()`.

Очищение волюма (все слиперы убиты) приводит к `wasCleared = true` в `SleeperVolume`, что используется в логике блокировки спавна (см. ниже) и в квестах `ObjectiveClearSleepers` через `QuestEventManager.Current.SleepersCleared(...)`.

**Параметры из XML:**

XML-описание самой системы биомного спавна загружается через `BiomeSpawningFromXml.Load(XmlFile)`: для каждой записи `<spawn>` создаются `BiomeSpawnEntityGroupData` с `idHash`, `maxCount`, `respawndelay` (умножается на `24000` — игровых тиков), `EDaytime` и тегами POI (`POITags`, `noPOITags`). Сами sleeper-волюмы и `BlockSleeper.SpawnGroup` задаются в данных префаба и в `entitygroups.xml`.

---

### 2.4. Блокировка спавна спальником

Спальник предотвращает спавн зомби двумя разными механизмами в зависимости от контекста: открытый мир и POI.

**(а) Биомный/динамический спавн (открытый мир).**

Все хелперы `World` для выбора позиции имеют параметр `bool _checkBedrolls`:

```csharp
public bool GetMobRandomSpawnPosWithWater(Vector3 _targetPos, int _minRange, int _maxRange,
    int _minPlayerRange, bool _checkBedrolls, out Vector3 _position) { ... }
```

Внутри (через `GetRandomSpawnPositionMinMaxToPosition`) вызывается:

```csharp
private bool isPositionInRangeOfBedrolls(Vector3 _position)
{
    int num = GamePrefs.GetInt(EnumGamePrefs.BedrollDeadZoneSize);
    num *= num; // используется как sqrMagnitude
    foreach (player in Players.list)
    foreach (pos in player.SpawnPoints)
        if ((pos.ToVector3() - _position).sqrMagnitude < num)
            return true;
    return false;
}
```

То есть проверка — это **сферическая** (точнее, по квадрату расстояния) зона с радиусом `BedrollDeadZoneSize` блоков от позиции `BedrollPos` любого игрока в `Players.list`. Если позиция-кандидат попадает в такую сферу — она отвергается.

Вызывающие места с `_checkBedrolls: true`:

- `SpawnManagerBiomes.SpawnUpdate` → `world.GetRandomSpawnPositionInAreaMinMaxToPlayers(... _checkBedrolls: true ...)` (стандартные биомные мобы/животные).
- `AIScoutHordeSpawner.SpawnUpdate` и `AIWanderingHordeSpawner.UpdateSpawn` (скауты и блуждающие орды).
- `GameManager` при выборе позиции «spawn near friend» (`_checkBedrolls: true, _checkLandClaim: true`).

Кровавая луна (`AIDirectorBloodMoonParty.CalcSpawnPos`) явно вызывает `GetMobRandomSpawnPosWithWater(... _checkBedrolls: false ...)` — то есть **зомби кровавой луны bedroll не блокирует**.

**(б) POI / SleeperVolume.**

Это нетривиальная часть. В `SleeperVolume.CheckTrigger`:

```csharp
if (wasCleared)
{
    if (GameUtils.CheckForAnyPlayerHome(GameManager.Instance.World, BoxMin, BoxMax)
        != GameUtils.EPlayerHomeType.None)
    {
        respawnTime = Math.Max(respawnTime, _world.worldTime + 24000);
        return false;
    }
    return true;
}
```

То есть проверка идёт **только если волюм уже был очищен хотя бы раз** (`wasCleared == true`, см. также константу `cBedrollClearTime = 24000`).

`GameUtils.CheckForAnyPlayerHome(World, Vector3i BoxMin, Vector3i BoxMax)`:

```csharp
double bedrollExpiry = GameStats.GetInt(EnumGameStats.BedrollExpiryTime) * 24.0;
int    deadZone     = GamePrefs.GetInt(EnumGamePrefs.BedrollDeadZoneSize);
Vector3i pad        = new Vector3i(deadZone, deadZone, deadZone);
Vector3i min        = BoxMin - pad;
Vector3i max        = BoxMax + pad;

foreach (player in persistentPlayerList.Players)
{
    if (player.Value.OfflineHours < bedrollExpiry && player.Value.HasBedrollPos)
    {
        Vector3i bp = player.Value.BedrollPos;
        if (bp.x >= min.x && bp.x < max.x && bp.z >= min.z && bp.z < max.z)
            return EPlayerHomeType.Bedroll;
    }
    // ... ниже идёт проверка LPBlocks
}
```

Важные следствия:

1. Проверка по спальнику **прямоугольная по XZ**, а не сферическая: к bounding-box POI добавляется `BedrollDeadZoneSize` по X/Z. Y не учитывается (имеется внутри `pad`, но фактический фильтр — только `x` и `z`).
2. Проверяется только `BedrollPos` (то есть, по сути, последний поставленный спальник конкретного игрока), а не позиция блока в мире.
3. Bedroll «истекает», если `OfflineHours >= BedrollExpiryTime * 24` — после этого защита снимается.
4. Эффект — `respawnTime += 24000` тиков (=`cBedrollClearTime`, ~1 игровые сутки), и `CheckTrigger` возвращает `false` → волюм не активируется → новый цикл спавна не запускается.
5. Это **не отменяет первый спавн** при первом заходе в POI: пока `wasCleared == false`, ни bedroll, ни land claim в `CheckTrigger` не проверяются. То есть «изначальные» слиперы POI всё равно появятся; bedroll работает только для **респавна** уже зачищенного POI.

Дополнительно, в `QuestEventManager.CheckForPOILockouts` используется `PrefabInstance.CheckForAnyPlayerHome(World)` (обёртка над тем же `GameUtils.CheckForAnyPlayerHome`) — если спальник внутри POI, возвращается `POILockoutReasonTypes.Bedroll`, и квест по этому POI не выдаётся.

**Итог для спальника:** в открытом мире — сферическая зона `BedrollDeadZoneSize` через `isPositionInRangeOfBedrolls`; в POI — прямоугольное расширение bounding-box POI на `BedrollDeadZoneSize` через `GameUtils.CheckForAnyPlayerHome`, но **только при респавне** уже зачищенного волюма.

---

### 2.5. Блокировка спавна блоком притязания (Land Claim)

Land Claim в коде не имеет аналога `_checkLandClaim` в общем биомном цикле `SpawnManagerBiomes.SpawnUpdate` — параметр существует у `GetRandomSpawnPositionMinMaxToPosition`, но используется в основном при выборе точки появления **игроков** (`GameManager` `RequestToSpawnPlayer`) и в `PlayerMoveController.findSpawnPosition` (поиск точки рядом с другом). Поэтому защита от **зомби** биомного слоя через keystone осуществляется не так, как через спальник. Главная и принципиально работающая защита — это POI-cценарий через тот же `GameUtils.CheckForAnyPlayerHome`.

**(а) POI / SleeperVolume.**

В `GameUtils.CheckForAnyPlayerHome` вторая часть метода:

```csharp
double lpExpiry   = GameStats.GetInt(EnumGameStats.LandClaimExpiryTime) * 24.0;
int    claimSize  = GameStats.GetInt(EnumGameStats.LandClaimSize);
int    halfClaim  = claimSize / 2;

foreach (player in ...)
{
    var lp = player.Value.LPBlocks;
    if (player.Value.OfflineHours >= lpExpiry || lp == null || lp.Count == 0) continue;
    for (int i = 0; i < lp.Count; i++)
    {
        Vector3i b = lp[i];
        b.x -= halfClaim;
        b.z -= halfClaim;
        if (b.x          <= BoxMax.x
         && b.x + claimSize >= BoxMin.x
         && b.z          <= BoxMax.z
         && b.z + claimSize >= BoxMin.z)
        {
            return EPlayerHomeType.Landclaim;
        }
    }
}
```

То есть проверяется пересечение **квадрата `LandClaimSize × LandClaimSize`**, центрированного на каждом блоке `lpblock` владельца, с прямоугольником POI `[BoxMin..BoxMax]` по XZ. Любого пересечения достаточно, чтобы вернуть `EPlayerHomeType.Landclaim`.

Эффект в `SleeperVolume.CheckTrigger` тот же самый, что и для bedroll: `respawnTime = max(respawnTime, worldTime + 24000)` и `return false`. То есть **в POI логика блокировки спавна спальником и keystone одинаковая** — через единый switch в `GameUtils.CheckForAnyPlayerHome`, и срабатывает только при `wasCleared == true`.

Различия:

| Параметр | Спальник | Land Claim |
| --- | --- | --- |
| Геометрия зоны | Расширение bounding-box POI на `BedrollDeadZoneSize` (XZ-прямоугольник) | Квадрат `LandClaimSize × LandClaimSize` на каждый `lpblock` |
| Источник позиций | `PersistentPlayerData.BedrollPos` (одна точка на игрока) | `PersistentPlayerData.LPBlocks` (список всех keystone игрока) |
| Срок действия | `OfflineHours < BedrollExpiryTime * 24` | `OfflineHours < LandClaimExpiryTime * 24` |
| Возвращаемое значение | `EPlayerHomeType.Bedroll` | `EPlayerHomeType.Landclaim` |
| Применение | `SleeperVolume.CheckTrigger` (POI-респавн) + `QuestEventManager.CheckForPOILockouts` | то же самое |

Помимо этого, для биомного и хордового спавна Land Claim **не используется** напрямую — у `SpawnManagerBiomes.SpawnUpdate`, `AIScoutHordeSpawner.SpawnUpdate`, `AIWanderingHordeSpawner.UpdateSpawn` параметр `_checkLandClaim` не выставлен в `true`. Поэтому в открытом мире «отгонять» зомби keystone не будет — это специфика именно спальника.

**(б) Что keystone дополнительно делает с миром.**

- Через `IsLandProtectedBlock` и `IsMyLandProtectedBlock` (см. `WorldBase`) увеличивается прочность блоков (модификатор `GetLandProtectionHardnessModifier`) — это не про спавн, но даёт «эффект защиты базы» от разрушения.
- `CanPlaceLandProtectionBlockAt` использует `EnumGameStats.LandClaimDeadZone` (DeadZone больше, чем сам keystone), чтобы предотвратить плотную постановку чужих keystone друг к другу.
- В `QuestEventManager.CheckForPOILockouts` keystone владельца, чей POI пересекает квадрат, возвращает `POILockoutReasonTypes.LandClaim` — POI блокируется от выдачи квестов.

**Принципиальное отличие от спальника** на уровне кода: keystone хранит **список позиций блоков** (`LPBlocks`), а спальник — **одну точку** (`BedrollPos`). Поэтому игрок может выстроить несколько перекрывающихся keystone и тем самым покрыть больший прямоугольник, тогда как «защита спальником» внутри POI всегда привязана к одному прямоугольнику вокруг bounding-box POI.

---

## 3. Итоговый вывод для игроков

Спальник и блок притязания работают по разной логике, и не везде они одинаково «защищают» от зомби.

Спальник в первую очередь — это точка возрождения. В открытом мире вокруг него действует невидимый круг, внутри которого обычные зомби, животные и блуждающие орды просто не выбираются в качестве кандидата на появление. Этот круг невелик и работает только пока спальник стоит, а вы не отсутствовали в игре слишком долго. На зомби кровавой луны спальник не действует — они появляются прямо на вас.

Внутри здания (POI) спальник тоже даёт защиту, но особым образом: пока вы ни разу не зачистили это здание, зомби-«спящие» внутри всё равно появятся при первом заходе — спальник не отменяет первоначальное наполнение здания врагами. А вот когда вы здание уже полностью очистили, спальник внутри (или совсем рядом с границами здания) не даст зомби возродиться заново — игра откладывает их повторное появление примерно на сутки. Если вас долго не было в игре, защита спальника постепенно «истекает», и зомби снова смогут появляться.

Блок притязания работает похоже, но мощнее, и иначе. В открытом мире он сам по себе обычных зомби не отгоняет — это не его задача. Он защищает ваши постройки от разрушения, мешает чужим игрокам ставить свои блоки слишком близко и убирает с вашей территории квесты и повторное наполнение зданий зомби. Внутри здания он работает по тому же принципу, что и спальник: если здание уже зачищено и ваш блок притязания накрывает его краем своей квадратной зоны — зомби в этом здании не возрождаются. Размер этой зоны задаётся настройками сервера и обычно заметно больше, чем у спальника. Кроме того, вы можете поставить несколько блоков притязания и накрыть ими большую территорию, тогда как «защитный круг» спальника всегда один — там, где лежит ваш последний спальник.

Главное на практике:

- Чтобы спокойно зачистить здание навсегда, нужно сначала его полностью убрать от зомби, а потом поставить рядом или внутри спальник либо блок притязания. До зачистки эти блоки не помешают зомби появиться в первый раз.
- В открытом мире только спальник реально мешает обычным зомби и животным появляться рядом. Блок притязания на «обычный» спавн в природе влияния не оказывает.
- Кровавую луну ни один из этих блоков не останавливает.
- Если вы надолго перестаёте заходить в игру, защита постепенно ослабевает: сначала «истечёт» спальник, чуть позже — блок притязания, и зомби снова смогут заселяться в ваше здание.