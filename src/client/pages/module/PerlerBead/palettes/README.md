# Bead reference palettes

`mard.json` contains the 291 code/HEX entries from
https://github.com/HansBug/pindou-color-data/tree/main/mard-291-github
(commit `178dafbc9e77d3de556550dbd058270200129186`, retrieved 2026-10-13).
The standard 221-code subset is A–H and M;
its entries match that repository's `mard-221-github` palette exactly.

The other palettes use the same source commit and MIT data license:

| Local file | Upstream directory | Included codes | Processing |
| --- | --- | ---: | --- |
| `coco.json` | `coco-291` | 291 | Preserve codes, including leading zeros |
| `manman.json` | `manman-278` | 278 | Preserve corrected upstream codes |
| `panpan.json` | `panpan-289` | 285 | Exclude 4 `unidentified` / `UNKNOWN-*` entries |
| `mixiaowo.json` | `mixiaowo-290` | 286 | Exclude 4 `unidentified` / `UNKNOWN-*` entries |

These numbers count known codes, not unique HEX values or a guaranteed retail
set size. COCO has 289 unique reference HEX values; Manman has 277. For identical
reference HEX values, matching always selects the first entry in source order,
both for exact and approximate matches. This keeps aliases from producing
inconsistent quantity lists. Unconfirmed codes are not guessed or exported.

These are community screen-color references, not factory measurements.
Special-effect beads are represented by their reference HEX only.
The upstream MIT data license is retained in `LICENSE`.

OKLab matrices: https://bottosson.github.io/posts/oklab/
(the author's implementation is public domain).
CIEDE2000 formula and verification data:
https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/

CIEDE2000 implementation: adapted from the MIT-licensed
https://github.com/yourlin/Fusible-Beads-Studio/blob/b12b157134af20a6480ece7984f07c3bdb202d2f/packages/shared/src/color/ciede2000.ts
Only its Lab input representation is changed to coordinate tuples.
Copyright and full license are preserved in `../colorMatching/`.
The combined notices in `src/client/public/third-party/perler-matching.txt`
are copied with the frontend's public assets for distribution.
