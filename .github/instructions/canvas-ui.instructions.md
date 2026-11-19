---
description: 'Apply when adding, changing, or reviewing viewer-owned canvas controls, styles, and portable-book UI.'
applyTo: 'view/**,scripts/export.mjs,tests/*.browser.mjs'
---

# Canvas UI consistency

The viewer is a documentation reader. Keep its controls consistent with VS Code without importing workbench services or restyling the product being documented.

## Reuse the owning control

| Purpose | Existing implementation |
| --- | --- |
| Expand inline content | `disclosureSummary(...)` in `view/ui.mjs`, inside native `details` |
| Run a command | Native `button` with `chrome-button`; use `secondary` for supporting commands |
| Compact toolbar action | `chrome-icon-button` with an accessible name and `codicon(...)` |
| Search or enter text | Labeled native input with `chrome-input` |
| Choose one value | Native `select` inside `chrome-select`, with the shared decorative chevron |
| Choose a fixture variant | `variantChoices(...)`; preserve its native radio semantics |
| Copy a token | `tokenButton(...)`, including its local copy feedback |
| Open a repository file | `sourceLink(...)`; preserve its allowlisted target and new-tab announcement |

Use the shared `chrome-disclosure` treatment for Further reading, Contributor resources, metadata, diagnostics, token groups, and optional Motion references. Do not mix browser disclosure triangles with custom chevrons or invent per-topic focus targets. For example, use `details.append(disclosureSummary('Further reading'), list)`, not `node('summary', 'Further reading')`. Static portable markup uses the same class and decorative Codicon.

Native `details` owns the expanded state and Enter/Space behavior; do not add redundant ARIA state or popup dismissal handlers to an inline disclosure. Use a button with explicit popup state only for an actual popup. Keep disclosure labels aligned, give equivalent rows the same hit area and focus boundary, and allow long labels to wrap.

## Keep styling ownership clear

- Shared controls belong in `view/ui.mjs` and the shared control section of `view/shell.css`. Topic CSS may express a real role difference, such as a token-group heading, but must not copy control geometry or override shared hover/focus behavior.
- Pair VS Code semantic foreground/background tokens with standalone fallbacks. Preserve light, dark, high-contrast, custom-theme, disabled, hover, pressed/open, and keyboard-focus states.
- Keyboard focus must remain visible with the pointer over the control. Use the same inset solid focus boundary for equivalent viewer controls; high-contrast hover must not win over keyboard focus.
- Use the existing Codicon helper and icon set. Do not use Unicode lookalikes, browser markers, or a second icon library for viewer chrome.
- Product specimens, theme illustrations, embedded fixtures, and intentional motion studies keep their source-defined styling. Do not apply a blanket viewer-control reset to them.
- Existing Motion playback uses larger icon targets for operating a demonstration, and token-copy/grid controls retain their content-specific layouts. Preserve those deliberate roles rather than making every button the same size.

## Preserve the reader hierarchy

Reuse the compact global bar, leading topic-menu trigger/left drawer, wide left sidebar, and separate local article title/section links. Do not duplicate the active topic label, add a checkout-status row, or reserve a guessed sticky-toolbar height. Keep optional contributor data after the article in normal flow.

## Verify the relationship, not just one control

Compare equivalent controls in the same rendered scene. For disclosures, check chevron and label alignment, full-row hit area, open/closed state, hover, and actual Tab/Enter/Space focus. For fields and buttons, compare dimensions and semantic theme pairs while preserving their different roles. Exercise narrow and wide layouts on one instance, plus light/dark and forced-colors focus-with-hover. Add a focused regression for the inconsistency being fixed; do not test only class names or one screenshot.

Run the relevant `tests/*.browser.mjs` against the selected checkout, not a separately installed copy. Check portable rendering when changing shared controls. A running native canvas must reload the saved client assets before it is evidence of the change; preserve its selected checkout, topic, and saved views.
