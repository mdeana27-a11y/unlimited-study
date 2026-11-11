# Contrast report (WCAG 2.1 AA)

Computed from the design tokens in `client/src/styles.css` (glass surfaces composited over the page colour). axe-core could auto-evaluate most text and reported **0 violations**, but marked text sitting on translucent/gradient surfaces as "needs review", so these ratios are the manual check for those.

| Theme | Pair | Ratio | Needed | Result |
|---|---|---|---|---|
| dark | ink on page | 16.17:1 | 4.5:1 | PASS |
| dark | muted on page | 8.57:1 | 4.5:1 | PASS |
| dark | ink on glass card | 14.9:1 | 4.5:1 | PASS |
| dark | muted on glass card | 7.9:1 | 4.5:1 | PASS |
| dark | ink on field | 12.72:1 | 4.5:1 | PASS |
| dark | muted on field | 6.74:1 | 4.5:1 | PASS |
| dark | accent text on glass | 9.65:1 | 4.5:1 | PASS |
| dark | error text on glass | 6.48:1 | 4.5:1 | PASS |
| dark | "new" chip (page colour on green) | 9.85:1 | 4.5:1 | PASS |
| dark | white on button indigo #4F46E5 | 6.29:1 | 4.5:1 | PASS |
| dark | white on button violet #7C3AED | 5.7:1 | 4.5:1 | PASS |
| light | ink on page | 15.28:1 | 4.5:1 | PASS |
| light | muted on page | 7.24:1 | 4.5:1 | PASS |
| light | ink on glass card | 15.82:1 | 4.5:1 | PASS |
| light | muted on glass card | 7.5:1 | 4.5:1 | PASS |
| light | ink on field | 15.99:1 | 4.5:1 | PASS |
| light | muted on field | 7.58:1 | 4.5:1 | PASS |
| light | accent text on glass | 5.3:1 | 4.5:1 | PASS |
| light | error text on glass | 6.22:1 | 4.5:1 | PASS |
| light | "new" chip (white on green) | 5.48:1 | 4.5:1 | PASS |
| light | gradient title: accent #0E7490 on page (large text) | 5.12:1 | 3:1 | PASS |
| light | gradient title: violet #6D28D9 on page (large text) | 6.79:1 | 3:1 | PASS |
