# Анализ изменения `ignore_loot_abundance` (7DTD 2.6 b14 → 3.0 b252)

## TL;DR

Это **намеренная переработка системы изобилия лута**, а не случайная поломка.
В 3.0 разработчики убрали атрибут `ignore_loot_abundance="true"` со **всех мировых
контейнеров** (сейфы, ящики, сундуки, почтовые ящики, закопанные припасы и т.д.) и
ввели новую покатегорийную систему через атрибут `abundance_type` на `lootgroup`,
рассчитанную на Sandbox-настройки.

**При настройках по умолчанию (LootAbundance = 100%) количество лута не меняется** —
всё умножается на 1.0. Изменение проявляется только при ненулевом отклонении
настройки LootAbundance от 100%: контейнеры, ранее иммунные к ползунку изобилия,
теперь ему подчиняются.

Важная оговорка: новая покатегорийная система в b252 **реализована лишь частично**
(каркас есть, но множители не привязаны ни к одной игровой настройке — см. ниже).

---

## Что именно изменилось в данных

Сравнение `Config/loot.xml`:

| Показатель | 2.6 b14 | 3.0 b252 |
|---|---|---|
| Всего `lootcontainer` | 337 | 339 |
| С `ignore_loot_abundance="true"` | 184 | 138 |
| └ из них twitch-контейнеры | 138 | 138 |
| └ из них **мировые** контейнеры | **46** | **0** |
| `lootgroup` с атрибутом `abundance_type` | 0 | 68 |

Иначе говоря: **все ~46 мировых контейнеров потеряли `ignore_loot_abundance`**,
а атрибут сохранился исключительно у `twitch_*` контейнеров (награды за
стримерские события).

### Контейнеры, потерявшие `ignore_loot_abundance` в 3.0

```
airDrop, atmLoot, bookcase, bookPile,
buriedSuppliesT1, buriedSuppliesT2, buriedTreasure, introBuriedSupplies,
constructionCrate, crackabookCrate, mopowerCrate, passngasCrate,
popnpillsCrate, savageCountryCrate, shamwayCrate, shotgunMessiahCrate,
workingStiffsCrate, gunSafe, smallSafes,
hardenedChestT4, hardenedChestT5, reinforcedChestT1, reinforcedChestT2, reinforcedChestT3,
hiddenStash, infestedT1..T5, mailbox, mailboxNoPop, PObox,
questRewardSkillMagazines, singleBooks,
weaponsBagLarge, weaponsBagSmall,
zPackReg, zPackNurse, zPackLab, zPackUtility, zPackSoldier,
zPackThug, zPackStrong, zPackBoss, zPackPlague
```

### Новый атрибут `abundance_type`

В 3.0 у групп лута появился `abundance_type` (комментарий в самом loot.xml:
`Loot group parameter abundance_type is for loot abundance Sandbox Options`).
Возможные значения (из enum `LootContainer.LootGroup.AbundanceLootModTypes`):
`Food, Drinks, Ammo, Meds, Resources, Armor, Melee, Ranged, Dukes, Magazines`.

То есть концепция «изобилия» переехала с уровня **контейнера** (бинарный
opt-out) на уровень **категории предметов** (множитель на тип лута).

---

## Как это работает в коде (декомпил Assembly-CSharp 3.0 b252)

### Парсинг
- `LootFromXml.cs`: всё ещё читает `ignore_loot_abundance` → поле
  `LootContainer.ignoreLootAbundance`.
- `LootFromXml.cs:373` — новый разбор: `if (_elementGroup.HasAttribute("abundance_type"))`
  → `Enum.TryParse(..., out lootGroup.abundanceType)`.

### Множители (`LootContainer.cs`)
```csharp
public static float GlobalCountModifier = 1f;   // глобальный (LootAbundance)
public static float FoodCountModifier   = 1f;   // покатегорийные
public static float ArmorCountModifier  = 1f;
public static float MagazinesCountModifier = 1f;
// ... и т.д. (Drinks, Ammo, Meds, Resources, Melee, Ranged, Dukes)
```

- `GlobalCountModifier` задаётся из `EnumGameStats.LootAbundance`
  (`GameStatsBridge.cs:70: LootContainer.GlobalCountModifier = ToFloatPercent(_newValue)`).
- Покатегорийные модификаторы (`FoodCountModifier` и др.) в коде **только читаются**
  (`GetCountMultiplierFromSandbox`), но **нигде не присваиваются** — остаются `1f`.
  В `EnumGameStats` есть только `LootAbundance`, отдельных настроек на категории нет.
  → В b252 покатегорийная система фактически **выключена** (всегда 1.0).

### Логика спавна — `LootContainer.Spawn(...)`
```csharp
float abundance = 1f;
if (ignoreLootAbundance) {                 // контейнер с ignore_loot_abundance="true"
    num = RandomSpawnCount(min, max, 1f);  // полный объём, ползунок игнорируется
    abundance = 1f;
}
else if (GlobalCountModifier > 1f) {       // LootAbundance > 100%
    ... abundance = GlobalCountModifier;   // больше лута
}
else {                                     // LootAbundance <= 100% (вкл. 100%)
    num = RandomSpawnCount(min, max, 1f);
    abundance = GlobalCountModifier;       // при 100% == 1.0; при <100% — меньше
}
```
`RandomSpawnCount(...)` в конце делает `num *= abundance`, то есть `abundance`
прямо масштабирует число выпадающих предметов.

---

## Поведение: было / стало

Пусть `LA` — настройка LootAbundance (по умолчанию 100%).

| LootAbundance | Мировой контейнер 2.6 (с ignore) | Мировой контейнер 3.0 (без ignore) | Twitch 2.6/3.0 (с ignore) |
|---|---|---|---|
| 100% (дефолт) | полный | **полный (без изменений)** | полный |
| 50% | полный (иммунитет) | **половина** | полный |
| 150% | полный (иммунитет) | **больше** | полный |
| 0% | полный (иммунитет) | **пусто** (см. `LootContainer.cs:295`) | полный |

Ключевой вывод: **на дефолтных настройках лут идентичен**. Разница появляется
только если игрок (или серверный конфиг) меняет LootAbundance.

---

## Случайность или умысел?

### Аргументы за умышленность (основная версия)
1. Изменение **системное и консистентное**: атрибут убран сразу со всех 46 мировых
   контейнеров, без единого исключения — это не похоже на случайную потерю
   нескольких строк.
2. Одновременно введён **новый механизм** `abundance_type` (68 групп) с явным
   комментарием в loot.xml про «loot abundance Sandbox Options». Старый
   per-container opt-out конфликтует с покатегорийным управлением: если бы сейф
   игнорировал изобилие, покатегорийные ползунки не влияли бы на его содержимое.
   Удаление `ignore_loot_abundance` с мировых контейнеров — логичный шаг новой модели.
3. Атрибут **намеренно сохранён только у `twitch_*`** контейнеров: награды за
   стримерские события обязаны выдавать ровно заданный набор независимо от любых
   настроек изобилия. Это осознанное исключение, а не остаток.

### Аргументы за «недоделку» (важная оговорка)
1. Покатегорийные множители (`FoodCountModifier`, `ArmorCountModifier`, …) в коде
   объявлены и читаются, но **не привязаны ни к одной игровой настройке** —
   всегда равны 1.0. В `EnumGameStats` присутствует только глобальный `LootAbundance`.
2. Пример группы с `abundance_type` в шапке loot.xml оставлен **закомментированным**
   (`<!-- <lootgroup name="skillMagazines" abundance_type="Magazines"> -->`).

→ Похоже на **поэтапный рефакторинг**: каркас новой системы заложен (атрибуты в
данных + поля и switch в коде), но UI/настройки Sandbox для покатегорийного
изобилия в b252 ещё не подключены.

---

## Практические последствия

- **Обычные игроки на дефолте** (LootAbundance 100%): изменений в количестве лута нет.
- **Игроки/серверы со сниженным LootAbundance**: сейфы, сундуки, спец-ящики,
  закопанные припасы, награды за квесты, zPack’и и пр. теперь выдают **меньше**
  (раньше были иммунны). Это заметное изменение баланса именно при не-дефолтных настройках.
- **Повышенный LootAbundance**: те же контейнеры теперь дают **больше**.
- **Twitch-награды**: без изменений (фиксированы).

## Вывод

Разработчики **не сломали лут случайно**. Это намеренная замена бинарного
per-container `ignore_loot_abundance` на покатегорийную систему `abundance_type`,
управляемую Sandbox-настройками. Побочные эффекты:
1. На дефолтных настройках поведение идентично прежнему.
2. Глобальный ползунок LootAbundance теперь влияет на ранее иммунные «дизайнерские»
   контейнеры.
3. Новая покатегорийная система в b252 ещё не активна (множители захардкожены в 1.0),
   поэтому полноценной замены функционала пока нет — фактически это «переходное»
   состояние, в котором единственный действующий регулятор — глобальный LootAbundance.

---

*Источники: `Config/loot.xml` (2.6-b14, 3.0-b252); декомпил Assembly-CSharp 3.0 b252:
`LootContainer.cs`, `LootFromXml.cs`, `GameStatsBridge.cs`, `EnumGameStats.cs`.*
