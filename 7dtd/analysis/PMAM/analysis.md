# Технический анализ механик перков 7 Days to Die

> Анализ декомпилированного кода (`Assembly-CSharp`, 2.6-b14) и конфигов игры.
> Перки: «Вьючный мул» (`perkPackMuleName`) и «Мастерство ловкости» (`perkAgilityMasteryName`, 4 ранг → `buffSpectersGraceName`).
> Контекст: мод DanzoLethalInfection (переработанная инфекция).

## 1. Краткий список найденных файлов и сущностей

**Конфиги** (`Data/Config`):
- `progression.xml` — `perkPackMule` (стр. ~1729–1812), `perkAgilityMastery` (стр. ~2760–2827)
- `buffs.xml` — `buffPackMuleDisplay` (стр. ~3140–3146), `buffSpectersGrace` (стр. ~3202–3215)
- `items.xml` — оружие зомби/животных, накладывающее инфекцию через события атаки

**Декомпил** (`2.6-b14`):
- `EntityAlive.cs` — `DamageEntity` (стр. 4486+), применение `GeneralDamageResist` (стр. 4525–4529), `damageEntityLocal` → `FireAttackedEvents` (стр. 4749), `FireEvent(onOtherAttackedSelf)` (стр. ~4767)
- `ItemActionAttack.cs` — `FireEvent(onSelfAttackedOther)` (стр. ~757–768)
- `EntityBuffs.cs` — `HasImmunity` / проверка `BuffResistance` перед наложением баффа (стр. ~624–634)
- `PassiveEffects.cs` — enum: `GeneralDamageResist`, `BuffResistance`, `BuffProcChance`

**Связь названий:** `perkPackMuleName` = локализационный ключ перка `perkPackMule`; `perkAgilityMasteryName` = ключ перка `perkAgilityMastery`; `buffSpectersGraceName` = ключ баффа `buffSpectersGrace`, который выдаётся **4-м рангом** `perkAgilityMastery`. То есть `buffSpectersGrace` — не отдельный перк, а служебный бафф-таймер ранга 4 «Мастерства ловкости».

---

## 2. Перк Вьючный мул (`perkPackMuleName`)

### 2.1 Где реализован
`progression.xml`, `<perk name="perkPackMule">` (~1729–1812). Базовые эффекты — `CarryCapacity` и `CraftingTime`. Боевая способность — пять отдельных `effect_group`, по одному на каждый ранг (`ProgressionLevel perkPackMule Equals 1..5`).

### 2.2 Как работает защита от физического урона
Каждый ранговый `effect_group` содержит:
```xml
<requirement name="ProgressionLevel" progression_name="perkPackMule" operation="Equals" value="N"/>
<requirement name="RandomRoll" seed_type="Random" min_max="0,100" operation="LTE" value="5|10|15|20|25"/>
<requirement name="IsAlive" target="self"/>
<requirement name="!IsAttachedToEntity"/>
<requirement name="!HasBuff" buff="buffInjuryBleeding,buffInternalBleeding,buffIsOnFire,buffDrowning03,buffShocked,buffRadiationPool"/>
<requirement name="!HasBuff" buff="buffTwitchBurn,buffTwitchShocked,buffTwitchRadiation"/>
    <triggered_effect trigger="onOtherAttackedSelf" action="PlaySound" .../>
    <triggered_effect trigger="onOtherAttackedSelf" action="AddBuff" buff="buffPackMuleDisplay"/>
    <passive_effect name="GeneralDamageResist" operation="base_add" level="N" value="1"/>
```

Ключевой эффект — `GeneralDamageResist value="1"`. В `EntityAlive.DamageEntity` (стр. 4525–4529):
```csharp
float num = Utils.FastMin(1f, EffectManager.GetValue(PassiveEffects.GeneralDamageResist, null, 0f, this));
float num2 = (float)_strength * num + accumulatedDamageResisted;
int num3 = Utils.FastMin(_strength, (int)num2);
accumulatedDamageResisted = num2 - (float)num3;
_strength -= num3;
```
При значении `1` множитель = `1.0` → `_strength` обнуляется. Это **полное поглощение урона конкретного удара**, срабатывающее **по шансу**: 5/10/15/20/25 % для рангов 1–5 (`RandomRoll LTE`).

Важно: это `GeneralDamageResist` (общее снижение), а не `PhysicalDamageResist`. Поглощается урон удара как таковой, а не только «физический» подтип.

### 2.3 Как работает защита от инфекции
**Её нет.** В блоке перка отсутствуют `BuffResistance`, тег `buffInfectionCatch` и любые упоминания инфекции. `buffPackMuleDisplay` (`buffs.xml` 3140–3146) — чисто визуальный бафф (`duration=1`, иконка щита, без эффектов).

Более того (см. раздел 3.4 и 4): даже поглощение урона **не блокирует** инфекцию, потому что инфекция завязана на событие атаки, а не на факт прохождения урона.

### 2.4 Условия срабатывания и ограничения
- Точное совпадение ранга (`Equals N`) + удачный `RandomRoll`.
- Игрок жив, не «прикреплён» (`!IsAttachedToEntity`).
- Не действует при активных: кровотечение, внутреннее кровотечение, горение, утопление 3-й стадии, электрошок, радиация, twitch-дебаффы.
- Срабатывает на `onOtherAttackedSelf` — момент получения удара.

### 2.5 Итог по механике
Вьючный мул — это **шанс (до 25 % на 5 ранге) полностью обнулить урон одного удара** через `GeneralDamageResist=1`. От инфекции не защищает никак.

---

## 3. Перк Мастерство ловкости (`perkAgilityMasteryName`)

### 3.1 Где реализован
`progression.xml`, `<perk name="perkAgilityMastery">` (~2760–2827). Ранги 1–3 и 5 — боевые бонусы (подкос ног, скорость перезарядки пистолетов, кровотечение от пистолетов/луков и т.д.). Интересующий эффект — отдельный `effect_group` ранга 4.

### 3.2 Как работает 4 ранг (`buffSpectersGraceName`)
Блок ранга 4 (~2806–2815):
```xml
<requirement name="CVarCompare" cvar="perkSpectersGrace" operation="LTE" value="0"/>
<requirement name="ProgressionLevel" progression_name="perkAgilityMastery" operation="GTE" value="4"/>
<requirement name="!IsAttachedToEntity"/>
<requirement name="EntityTagCompare" target="other" tags="zombie,animal"/>
    <passive_effect name="GeneralDamageResist" operation="base_add" value="1"/>
    <triggered_effect trigger="onOtherAttackedSelf" action="PlaySound" .../>
    <triggered_effect trigger="onOtherAttackedSelf" action="AddBuff" target="self" buff="buffSpectersGrace"/>
```
`buffSpectersGrace` (`buffs.xml` 3202–3215):
```xml
<buff name="buffSpectersGrace" ... duration="60">
    <effect_group>
        <triggered_effect trigger="onSelfBuffStart"  action="ModifyCVar" cvar="perkSpectersGrace" operation="set" value="1"/>
        <triggered_effect trigger="onSelfBuffFinish" action="RemoveCVar" cvar="perkSpectersGrace"/>
        <triggered_effect trigger="onSelfBuffRemove" action="RemoveCVar" cvar="perkSpectersGrace"/>
    </effect_group>
</buff>
```
Логика «перезарядки»: пока активен бафф, cvar `perkSpectersGrace=1`. Требование `perkSpectersGrace LTE 0` не даёт эффекту сработать повторно. Через 60 секунд бафф истекает, cvar снимается → эффект снова доступен. То есть **гасит первый удар, восстанавливается раз в 60 секунд**.

### 3.3 Как работает уклонение от удара
По коду это **не уклонение в прямом смысле** (нет `DodgeChance`, нет броска на «промах врага»). Это тот же `GeneralDamageResist value="1"` → 100 % поглощение урона (`EntityAlive.DamageEntity`, стр. 4525–4529, тот же путь, что у Вьючного мула). Визуально «уклонение/парирование первого удара», механически — обнуление урона одного удара с откатом 60 секунд.

Отличия от Вьючного мула: **не по шансу**, а гарантированно (раз в 60 с), и только против врагов с тегом `zombie,animal` (`EntityTagCompare`).

### 3.4 Как работает защита от инфекции
**Прямой защиты нет** — в блоке перка и в `buffSpectersGrace` отсутствуют `BuffResistance`/`buffInfectionCatch`.

Косвенная защита («нет урона → нет инфекции») **кодом НЕ подтверждается** — наоборот, опровергается. В `EntityAlive.DamageEntity` после обнуления `_strength` (стр. 4529) безусловно вызывается `damageEntityLocal(_strength=0)` (стр. 4530) → внутри безусловно `FireAttackedEvents` (стр. 4749) → `FireEvent(MinEventTypes.onOtherAttackedSelf)` (стр. ~4767). Событие атаки на жертве фаерится **даже при уроне 0**. Аналогично `onSelfAttackedOther` на атакующем (`ItemActionAttack.cs` ~757–768) фаерится при `ModStrength != -1` (а 0 ≠ -1).

Так как и ванильная инфекция (`buffInfectionCatch` через события атаки), и инфекция мода DanzoLethalInfection (`DanzoInfectionReceiver` ловит `onOtherAttackedSelf` + `EntityTagCompare`; финальный `AddBuff buffDanzoInfectionApply` требует только `.danzoInfectionAmount>0` и `!HasBuff buffDrugVitamins`, **без проверки урона**) — обе срабатывают на событии, а не на уроне → **инфекция накладывается, несмотря на поглощённый удар**.

### 3.5 Условия срабатывания и ограничения
- Ранг ≥ 4, cvar `perkSpectersGrace ≤ 0` (не на откате), игрок не «прикреплён», атакующий — зомби/животное.
- Срабатывает на первом подходящем ударе, далее 60 с откат.
- Не распространяется на источники без тега `zombie,animal` (ловушки, падение, среда и т.п.).

### 3.6 Итог по механике
4 ранг Мастерства ловкости — **гарантированное обнуление урона одного удара зомби/животного раз в 60 секунд** через `GeneralDamageResist=1`. От инфекции не защищает.

---

## 4. Сравнение двух механик

**Похожи:**
- Оба используют один движковый механизм — `passive_effect GeneralDamageResist value="1"` → 100 % поглощение урона удара в `EntityAlive.DamageEntity` (4525–4529).
- Оба вешают служебный бафф на `onOtherAttackedSelf` (`buffPackMuleDisplay` / `buffSpectersGrace`) и проигрывают звук `twitch_bucket_hit`.
- Оба требуют `!IsAttachedToEntity`.
- **Оба не дают защиты от инфекции** и не прерывают цепочку инфекции, т.к. события атаки фаерятся при нулевом уроне.

**Отличаются:**

| | Вьючный мул | Мастерство ловкости р.4 |
|---|---|---|
| Триггер защиты | шанс `RandomRoll` 5–25 % | гарантированно, откат 60 с (cvar `perkSpectersGrace`) |
| Против кого | любой источник `onOtherAttackedSelf` | только `zombie,animal` (`EntityTagCompare`) |
| Доп. условия | блокируется DoT-дебаффами (кровь/огонь/шок/радиация/twitch) | блокируется только активным откатом |
| Бафф | `buffPackMuleDisplay` (1 с, UI) | `buffSpectersGrace` (60 с, таймер отката) |

**Описание против кода:** локализация называет это «поглощением урона»/«грациозным уклонением». Фактически у обоих это `GeneralDamageResist=1` (обнуление урона удара), а не отдельная система dodge. Названия `buffSpectersGrace`/`buffPackMuleDisplay` — лишь индикаторы; реальная защита в `passive_effect`. Связи с инфекцией в коде нет.

---

## 5. Детальный разбор: почему обнулённый удар не спасает от инфекции (ванильная цепочка)

Главный практический вопрос: «если перк поглотил удар и урон = 0, накладывается ли инфекция?» Ответ строго по коду: **да, накладывается (ванильно — по шансу, в моде — гарантированно)**. Косвенной защиты «0 урона → нет инфекции» нет. Доказательство — полная цепочка.

### 5.1 Как ванильная инфекция вешается на удар

Инфекция привязана к **событию атаки**, а не к величине прошедшего урона:

1. **Оружие зомби** `meleeHandZombie01` (`items.xml`, стр. 6503–6505):
```xml
<triggered_effect trigger="onSelfAttackedOther" action="AddBuff" target="other" fireOneBuff="true"
    buff="buffFatiguedTrigger,buffArmSprainedCHTrigger,buffLegSprainedCHTrigger,buffLaceration,buffAbrasionCatch,buffInjuryStunned01CHTrigger,buffInjuryBleedingTwo"
    weights=".11,.07,.07,.05,.29,.36,.11"/>
```
На событии `onSelfAttackedOther` (зомби ударил игрока) `fireOneBuff` выдаёт игроку ОДИН crit-бафф по весам.

2. Crit-баффы (`buffAbrasionCatch` стр. 3949–3952, и `buff*CHTrigger`) при старте дают `buffOnAnyCrit`:
```xml
<triggered_effect trigger="onSelfBuffStart" action="AddBuff" buff="buffOnAnyCrit"/>
```

3. `buffOnAnyCrit` (`buffs.xml`, стр. 3760–3766) и есть «генератор инфекции»:
```xml
<effect_group>
    <requirement name="CVarCompare" cvar="noTeethNoInfection" operation="LT" value="1"/>
    <requirement name="!HasBuff" buff="buffPreacherFullSetBonusCheck,buffInfectionImmunity"/>
        <passive_effect name="BuffResistance" operation="base_add" value="-.1" tags="buffInfectionCatch"/>
        <triggered_effect trigger="onSelfBuffStart" action="AddBuff" buff="buffInfectionCatch"/>
</effect_group>
```
Единственный гейт здесь — `noTeethNoInfection` (перк «Громила») и иммунитет/сет Preacher. Pack Mule / Agility Mastery в условиях не участвуют.

(Вторая строка оружия — `ModifyCVar infectionCounter +=10` с `requirement infectionCounter GT 0`, стр. 6514 — лишь усиливает уже существующую инфекцию, это не первичное заражение.)

### 5.2 Обнулённый удар всё равно фаерит событие атаки

- `EntityAlive.DamageEntity` (стр. 4525–4530, 4553): `GeneralDamageResist=1` обнуляет `_strength` → вызывает `damageEntityLocal(0)` → возвращает `dmResponse.ModStrength`. При нуле `ModStrength = 0` (стр. 4721), а **не `-1`**. Ранние `return -1` относятся к другим случаям (god-mode, friendly-fire, зомби-по-зомби — стр. 4497/4504/4509/4513), но НЕ к поглощённому урону.
- `damageEntityLocal` (стр. 4581+) не имеет раннего выхода при `_strength==0`: `DamageResponse` создаётся со `Strength=0`, проходит метод до конца, где **безусловно** вызывается `FireAttackedEvents(_dmResponse)` (стр. 4749).
- `FireAttackedEvents` (стр. 4754–4767) безусловно фаерит `onOtherAttackedSelf` на жертве (этот путь ловит инфекция **мода**).
- `ItemActionAttack` (стр. 757–768): `num8 = DamageEntity(...)`; `if (num8 != -1)` → фаерит `onSelfAttackedOther` (стр. 766, 768). Так как `num8 = 0 ≠ -1`, событие **срабатывает** → оружие зомби накладывает crit-баффы → инфекция (ванильный путь).

### 5.3 Единственное, что реально завязано на урон

`ItemActionAttack` (стр. 769–771): событие `onSelfDamagedOther` фаерится **только** при `RecordedDamage.Strength > 0`:
```csharp
if ((bool)entityAlive2 && entityAlive2.RecordedDamage.Strength > 0)
{
    entityAlive.FireEvent(MinEventTypes.onSelfDamagedOther, flag3);
}
```
То есть от величины урона зависит `onSelfDamagedOther` (и пороги стана/нокдауна/pain-hit внутри `damageEntityLocal`), но **инфекция к ним не привязана** — она на `onSelfAttackedOther` / `onOtherAttackedSelf`.

### 5.4 Итог по инфекции

| | Завязано на урон? | Срабатывает при 0 урона? |
|---|---|---|
| `onSelfAttackedOther` (ваниль: crit-баффы → инфекция) | нет | **да** |
| `onOtherAttackedSelf` (мод: `buffDanzoInfectionApply`) | нет | **да** |
| `onSelfDamagedOther` (эффекты «по нанесённому урону») | да (`Strength>0`) | нет |

Вывод: обнуление урона перками **не меняет шанс инфекции** — ванильно поглощённый удар прокает инфекцию ровно с той же вероятностью, что и обычный; в моде `buffDanzoInfectionApply` вообще не проверяет урон (только тег врага и отсутствие витаминов). Реальный гейт инфекции в ванильной цепочке — `noTeethNoInfection` (перк «Громила»), а не Pack Mule / Agility Mastery.

---

## 6. Блок-вывод для обычного игрока

### Вывод

**Вьючный мул.** Кроме увеличения места в рюкзаке, этот навык даёт *случайный шанс* полностью погасить один полученный удар — урон от него становится нулевым. Шанс растёт с уровнем: примерно от 5 % на первом до 25 % на пятом. Срабатывает не всегда и не работает, если вы горите, истекаете кровью, тонете, получили удар током или облучение. Звук и всплывающая иконка щита — признак, что удар поглощён.

**Мастерство ловкости, 4 ранг.** Даёт «отражение первого удара»: один удар зомби или животного гасится полностью (урон ноль), после чего способность восстанавливается раз в минуту. В отличие от Вьючного мула, тут нет случайности — но работает только против зомби и зверей и только один раз в 60 секунд.

**Как помогают в бою.** Оба навыка спасают именно от *урона по здоровью*: иногда (Вьючный мул) или раз в минуту (Мастерство ловкости) опасный удар проходит «вхолостую». Это полезно против сильных врагов и в плотной свалке.

**Насколько защищают от инфекции.** Не защищают вообще. Даже когда удар поглощён и здоровье не пострадало, игра всё равно засчитывает сам факт удара — а заражение в игре (и тем более в моде) привязано именно к факту удара, а не к урону. Поэтому заразиться можно даже от удара, от которого вы «не получили урона». От инфекции спасают другие вещи (например, выбивание зубов врагу навыком «Громила», витамины), но не эти два навыка.

**Скрытые ограничения.** Вьючный мул отключается, если на вас висит кровотечение/огонь/шок/радиация и т.п. Мастерство ловкости работает лишь против зомби и животных и только раз в 60 секунд. Ни один из них не делает вас неуязвимым и ни один не мешает заражению.

---

*Достоверность: вывод «перки не блокируют инфекцию» доказан управляющим потоком в `EntityAlive.DamageEntity`/`damageEntityLocal` (события атаки вызываются безусловно, раннего выхода при уроне 0 нет). Для мода DanzoLethalInfection это особенно жёстко: финальный `AddBuff buffDanzoInfectionApply` не проверяет урон, только тег врага и отсутствие витаминов.*
