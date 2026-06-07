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

## 5. Блок-вывод для обычного игрока

### Вывод

**Вьючный мул.** Кроме увеличения места в рюкзаке, этот навык даёт *случайный шанс* полностью погасить один полученный удар — урон от него становится нулевым. Шанс растёт с уровнем: примерно от 5 % на первом до 25 % на пятом. Срабатывает не всегда и не работает, если вы горите, истекаете кровью, тонете, получили удар током или облучение. Звук и всплывающая иконка щита — признак, что удар поглощён.

**Мастерство ловкости, 4 ранг.** Даёт «отражение первого удара»: один удар зомби или животного гасится полностью (урон ноль), после чего способность восстанавливается раз в минуту. В отличие от Вьючного мула, тут нет случайности — но работает только против зомби и зверей и только один раз в 60 секунд.

**Как помогают в бою.** Оба навыка спасают именно от *урона по здоровью*: иногда (Вьючный мул) или раз в минуту (Мастерство ловкости) опасный удар проходит «вхолостую». Это полезно против сильных врагов и в плотной свалке.

**Насколько защищают от инфекции.** Не защищают вообще. Даже когда удар поглощён и здоровье не пострадало, игра всё равно засчитывает сам факт удара — а заражение в игре (и тем более в моде) привязано именно к факту удара, а не к урону. Поэтому заразиться можно даже от удара, от которого вы «не получили урона». От инфекции спасают другие вещи (например, выбивание зубов врагу навыком «Громила», витамины), но не эти два навыка.

**Скрытые ограничения.** Вьючный мул отключается, если на вас висит кровотечение/огонь/шок/радиация и т.п. Мастерство ловкости работает лишь против зомби и животных и только раз в 60 секунд. Ни один из них не делает вас неуязвимым и ни один не мешает заражению.

---

*Достоверность: вывод «перки не блокируют инфекцию» доказан управляющим потоком в `EntityAlive.DamageEntity`/`damageEntityLocal` (события атаки вызываются безусловно, раннего выхода при уроне 0 нет). Для мода DanzoLethalInfection это особенно жёстко: финальный `AddBuff buffDanzoInfectionApply` не проверяет урон, только тег врага и отсутствие витаминов.*
