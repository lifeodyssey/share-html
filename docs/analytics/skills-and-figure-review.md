# Research and visualization guidance

The owner requested relevant skills from both repositories below. The following four skills were installed into the local Codex skill directory on September 24, 2026 (Taipei), using the standard skill installer and pinned upstream revisions. No repository-wide installation or dependency replacement was performed.

| Repository | Revision | Skills |
| --- | --- | --- |
| [HughYau/AcademicForge](https://github.com/HughYau/AcademicForge) | `01b6d90c5b50ba0aa48b6564e45ee4a0ade9487c` | `figure-style` |
| [K-Dense-AI/scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills) | `49c6e97775eaa18ba791bebe23162a70ae601c18` | `scientific-visualization`, `exploratory-data-analysis`, `statistical-analysis` |

## Application to the September 23 report

- Preserve canonical frozen data, units, denominators, missing days and partial periods. Sharing records, network requests, unique files and people are different units.
- Name both Cartesian axes, including date timezone and count/percentage units. Sankey stages and ribbon width have an explicit explanation instead of artificial axes.
- Use a plain white surface and near-black text. Keep category colors stable across related charts; supplement colors with direct labels, values and accessible tables.
- Distinguish observed data, rule-based artifact classification and unknowns. Do not use an observational before/after series to claim a causal SEO, GEO or WebMCP effect.
- Review rendered Chinese and English figures, not only source code. Keep interactive web SVG figures; Matplotlib-specific typography/export defaults do not directly apply to browser rendering.
- Statistical-analysis guidance supports honest descriptive interpretation here; no significance tests or confidence intervals were added without a defensible sampling model.

## Palette screening

The installed scientific-visualization `palette_audit.py` helper was read with its local dependencies and run without network access. Its Okabe-Ito-on-white subset (`#0072B2`, `#D55E00`, `#009E73`, `#CC79A7`, `#000000`) passes the helper's 3:1 opaque graphical contrast screen against white. Four of ten color pairs need review under its heuristic grayscale separation screen. This is a palette screen, not a rendered-figure accessibility certification; direct labels and data tables remain necessary. Light orange requires a darker outline or replacement when used as a required mark on white.

References:

- [Nature Research figure preparation](https://research-figure-guide.nature.com/figures/preparing-figures-our-specifications/)
- [Matplotlib: choosing colormaps](https://matplotlib.org/stable/users/explain/colors/colormaps.html)
- Kassis, T., Agarwal, V., He, Y., Patel, D., & Brueckner, A. M. (2026). [Scientific Agent Skills: A Library of Procedural Knowledge for Research Agents](https://doi.org/10.48550/arXiv.2609.00065).
