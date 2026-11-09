# Ассеты и лицензии

## Game Icons

Файлы в `assets/icons` — готовые SVG из коллекции **Game Icons**, полученные через Iconify API. Исходные контуры не редактировались; цвет меняется только средствами CSS при отображении.

- Правообладатели: Game Icons contributors / GameIcons.
- Сайт и авторы: https://game-icons.net/about.html
- Репозиторий: https://github.com/game-icons/icons
- Лицензия: Creative Commons Attribution 3.0 Unported (CC BY 3.0), https://creativecommons.org/licenses/by/3.0/
- Копия условий: `assets/GAME-ICONS-LICENSE.txt`.

Использованные файлы и источники:

- `paper-clip.svg` — https://api.iconify.design/game-icons/paper-clip.svg
- `sewing-string.svg` — https://api.iconify.design/game-icons/sewing-string.svg
- `pencil.svg` — https://api.iconify.design/game-icons/pencil.svg
- `crystal-ball.svg` — https://api.iconify.design/game-icons/crystal-ball.svg
- `sewing-needle.svg` — https://api.iconify.design/game-icons/sewing-needle.svg
- `ink-swirl.svg` — https://api.iconify.design/game-icons/ink-swirl.svg
- `umbrella.svg` — https://api.iconify.design/game-icons/umbrella.svg
- `rubber-boot.svg` — https://api.iconify.design/game-icons/rubber-boot.svg
- `echo-ripples.svg` — https://api.iconify.design/game-icons/echo-ripples.svg
- `magnet.svg` — https://api.iconify.design/game-icons/magnet.svg
- `ticket.svg` — https://api.iconify.design/game-icons/ticket.svg
- `fire.svg` — https://api.iconify.design/game-icons/fire.svg
- `thermometer-cold.svg` — https://api.iconify.design/game-icons/thermometer-cold.svg
- `spider-web.svg` — https://api.iconify.design/game-icons/spider-web.svg
- `big-gear.svg` — https://api.iconify.design/game-icons/big-gear.svg
- `spring.svg` — https://api.iconify.design/game-icons/spring.svg
- `alarm-clock.svg` — https://api.iconify.design/game-icons/alarm-clock.svg
- `cycle.svg` — https://api.iconify.design/game-icons/cycle.svg
- `boots.svg` — https://api.iconify.design/game-icons/boots.svg
- `footprint.svg` — https://api.iconify.design/game-icons/footprint.svg
- `lab-coat.svg` — https://api.iconify.design/game-icons/lab-coat.svg
- `mirror-mirror.svg` — https://api.iconify.design/game-icons/mirror-mirror.svg
- `magnifying-glass.svg` — https://api.iconify.design/game-icons/magnifying-glass.svg
- `butterfly.svg` — https://api.iconify.design/game-icons/butterfly.svg
- `heart-battery.svg` — https://api.iconify.design/game-icons/heart-battery.svg
- `unlit-bomb.svg` — https://api.iconify.design/game-icons/unlit-bomb.svg
- `key.svg` — https://api.iconify.design/game-icons/key.svg
- `keyring.svg` — https://api.iconify.design/game-icons/keyring.svg
- `sword-slice.svg` — https://api.iconify.design/game-icons/sword-slice.svg
- `speedometer.svg` — https://api.iconify.design/game-icons/speedometer.svg
- `anvil.svg` — https://api.iconify.design/game-icons/anvil.svg
- `poison-bottle.svg` — https://api.iconify.design/game-icons/poison-bottle.svg
- `blood.svg` — https://api.iconify.design/game-icons/blood.svg
- `laser-blast.svg` — https://api.iconify.design/game-icons/laser-blast.svg
- `arrow-cluster.svg` — https://api.iconify.design/game-icons/arrow-cluster.svg

## 0x72 DungeonTileset II

Файл `assets/units/dungeon-tileset-ii-v1.7.png` — готовый атлас **DungeonTileset II v1.7** с персонажем, монстрами и кадрами idle/run/hit.

- Автор: **0x72**, оригинальная страница и подтверждение CC0: https://0x72.itch.io/dungeontileset-ii
- Лицензия: Creative Commons Zero 1.0 Universal (CC0), https://creativecommons.org/publicdomain/zero/1.0/
- Подтверждённое зеркало атласа: https://github.com/ernestwwchin/myworld/tree/main/public/assets/vendor/0x72_dungeon/0x72_DungeonTilesetII_v1.7
- Координаты кадров сохранены в `assets/units/tile_list_v1.7.txt`.
- Пиксели атласа не изменялись. Код выбирает source-rect кадры, отзеркаливает и масштабирует их во время рендера.
- Для вариантов Архивного компактора, Первого невозврата, Архивного химика и Калибратора поверх исходных кадров применяются цветовые фильтры и накладываются готовые иконки Game Icons. Это программные визуальные варианты и масштабирование, а не новые файлы другого автора.

## Press Start 2P

Файл `assets/fonts/PressStart2P-Regular.ttf` — готовый пиксельный шрифт **Press Start 2P** с поддержкой кириллицы, используемый для надписей на Canvas.

- Источник: https://github.com/google/fonts/tree/main/ofl/pressstart2p
- Лицензия: SIL Open Font License 1.1, http://scripts.sil.org/OFL
- Копия лицензии: `assets/fonts/PressStart2P-OFL.txt`.
- Шрифт не изменялся; начертание и размер задаются при рендере.

## pixelfx

Локальные исходники из `C:\Projects\YandexGames\pixelfx`, версия 0.3.0.

- Сайт/репозиторий: https://github.com/patch-gg/pixelfx
- Copyright (c) 2026 Patch и Hugo Duprez; дополнительные сведения в `vendor/pixelfx/NOTICE.md`.
- Лицензия MIT: `vendor/pixelfx/LICENSE`.
- Перенесены `src/core` и 15 эффектов в `vendor/pixelfx/fx`. Галерея и шрифт Patch Pixel не переносились.

Звуки синтезируются через Web Audio без внешних аудиофайлов. Собственные SVG для юнитов не создавались.

## Дополнительные герои и враги

Оригинальные загруженные файлы хранятся в `assets/packs`. Производные атласы находятся в `assets/units/generated`, а координаты, якоря и темп кадров — в `src/sprite-manifest.js`. `tools/build-unit-atlas.py` выполняет только выбор кадров, обрезку пустых полей и объединение PNG; пиксели не перерисовываются. Масштабирование и отражение по горизонтали происходят при рендере. Отсутствующие в пакетах анимации не подменяются самодельными рисунками.

### LuizMelo — Monsters Creatures Fantasy

- Автор: **LuizMelo**.
- Оригинальная страница: https://luizmelo.itch.io/monsters-creatures-fantasy
- Проверенный ZIP: https://hydecogames.com/art/data/packs/luizmelo-monsters-creatures-fantasy.zip
- Лицензия: **CC0 1.0**, https://creativecommons.org/publicdomain/zero/1.0/
- Условия сохранены в `assets/packs/luizmelo/LICENSE.txt`; измерения кадров — в `frame-info.json`.

Использованы Skeleton, Mushroom, Goblin и Flying Eye. Для них собраны исходные idle/walk/flight/run, attack, take hit, death и отдельный shield скелета. Размеры кадров в исходном пакете различаются, поэтому в манифесте сохранены индивидуальные прямоугольники и якоря. У Flying Eye исходная flight используется и для покоя, и для движения.

### chierit — Water Priestess и Fire Knight

- Автор: **chierit**.
- Water Priestess: https://chierit.itch.io/elementals-water-priestess
- Fire Knight: https://chierit.itch.io/elementals-fire-knight
- Официальный набор GDevelop: https://gdevelop.io/asset-store/free/elementals-chierit
- Лицензия: **CC BY 4.0**, https://creativecommons.org/licenses/by/4.0/
- Автор также пишет «Please don't resell». Отдельную перепродажу ресурсов не разрешаем себе этой атрибуцией; использование в игре и редактирование автором разрешены.
- Условия, полный текст лицензии, официальные метаданные и точные URL скачивания сохранены в `assets/packs/chierit-water` и `assets/packs/chierit-fire`.

Для Water Priestess использованы Idle, Walk, Attack1, Take Hit и Death; для Fire Knight — Idle, Run, Attack1, Take Hit и Death. Получено 180 исходных PNG жрицы и 163 PNG рыцаря. В атласы включены выбранные кадры с обрезкой пустого верхнего поля и сохранением исходной нижней точки привязки. Внесённые изменения: объединение кадров, обрезка прозрачных полей, масштабирование и отражение при отрисовке. Автор не заявляется как спонсор или участник этой игры.

### Snoblin — Top-down Prototype Character

- Автор: **Snoblin**.
- Официальная страница: https://store.godotengine.org/asset/snoblin/top-down-prototype-character/
- Использованный ZIP: https://store.godotengine.org/asset/snoblin/top-down-prototype-character/download/108/
- Лицензия: **CC0 1.0**, https://creativecommons.org/publicdomain/zero/1.0/
- Оригинальная лицензия: `assets/packs/snoblin/License.txt`.

Стажёр использует `prototype_character.png`: idle, walk, hurt и death вниз, вбок и вверх. Боковые кадры отражаются для противоположного направления. Собственных attack/run в этом пакете нет; для движения используется исходный walk. Из атласа удалён только пустой нижний край каждой 32×32 ячейки после 26-й строки.

### Calciumtrice — Animated Rat and Bat

- Автор: **Calciumtrice**.
- Подтверждённая страница: https://opengameart.org/content/animated-rat-and-bat
- Оригинальный PNG: https://opengameart.org/sites/default/files/rat%20and%20bat%20spritesheet%20calciumtrice.png
- Лицензия: **CC BY 3.0**, http://creativecommons.org/licenses/by/3.0/
- Подтверждение: `assets/packs/calciumtrice/LICENSE.txt`.

Использованы исходные ряды rat/bat idle, gesture, walk, attack и death. Для игровых состояний run выбран исходный walk. Обрезаны прозрачные поля ячеек; цвета и пиксели существ не изменялись. Обязательная атрибуция: **Animated Rat and Bat by Calciumtrice — CC BY 3.0**.

### CHROME DISTRICT — Relay Cass

- Официальный сайт и подтверждение **CC0 1.0**: https://chromedistrict.xyz/
- Исходный атлас: https://chromedistrict.xyz/v2-sprites/relay-cass_ortho_sheet.png
- Метаданные: https://chromedistrict.xyz/v2-sprites/relay-cass_ortho_sheet.json
- Лицензия: https://creativecommons.org/publicdomain/zero/1.0/
- Сохранённые условия: `assets/packs/chrome-district/LICENSE.txt` и `CC0-1.0-legalcode.txt`.

Курьер использует официальный Relay Cass (`CD2-0001`) из бесплатного публичного playground. Применены исходные walk/run, восемь направлений (четыре хранимых ряда плюс отражение), idle из первого walk-кадра. В этих атласах нет attack/hit/death; они не имитируются. Полный платный Vol. 2 не скачивался и не распространяется. Дополнительный low-атлас и его JSON сохранены без изменений.

## Не включено

- **Rogue Fantasy Catacombs** — официальная страница https://szadiart.itch.io/rogue-fantasy-catacombs не дала ZIP через доступный поток загрузки. Ни декорации, ни файлы этого пакета в игру не добавлены.
- **Mana Seed** — не включён из-за ограничений использования, включая запрет AI.
- **LPC** — не включён, чтобы не переносить на проект обязательства CC BY-SA/GPL без отдельного лицензионного решения.
- **Cainos** — не включён из-за ограничения на распространение исходного пакета.

Пустые папки недоступных пакетов не являются игровыми ассетами. Самодельные замены для них не создавались.
