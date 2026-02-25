# TORCH Style Guide

This document outlines the design system, color palette, and typography used in the TORCH project (`dashboard/` and `landing/`).

## Color Palette

The project uses a dark theme with high-contrast text and vibrant accents.

### Core Colors

| Name           | CSS Variable       | Hex       | Usage                                      |
|:---------------|:-------------------|:----------|:-------------------------------------------|
| **Surface**    | `--surface`        | `#0b1020` | Main background color.                     |
| **Surface Alt**| `--surface-alt`    | `#151b2f` | Card backgrounds, headers, secondary areas.|
| **Text**       | `--text`           | `#dbe4ff` | Primary body text (slightly blue-tinted).  |
| **Text Strong**| `--text-strong`    | `#ffffff` | Headings, emphasized text.                 |
| **Muted**      | `--muted`          | `#9aa6c6` | Secondary text, metadata, descriptions.    |
| **Border**     | `--border`         | `#2a3456` | Borders for cards, inputs, dividers.       |

### Brand & Functional Colors

| Name           | CSS Variable       | Hex       | Usage                                      |
|:---------------|:-------------------|:----------|:-------------------------------------------|
| **Accent**     | `--accent`         | `#4f8cff` | Primary buttons, active states, links.     |
| **Accent Strong**| `--accent-strong`| `#2f6be5` | Hover states for accent elements.          |
| **Info**       | `--info`           | `#46b7ff` | Informational messages, icons.             |
| **Info Strong**| `--info-strong`    | `#8ad4ff` | Stronger info emphasis.                    |
| **Success**    | `--success`        | `#35c47c` | Success messages, "Active" statuses.       |
| **Warning**    | `--warning`        | `#f5b84b` | Warning alerts.                            |
| **Danger**     | `--danger`         | `#ff6b6b` | Error messages, destructive actions.       |

### Auxiliary Colors

| Name           | CSS Variable       | Hex       |
|:---------------|:-------------------|:----------|
| **Purple**     | `--purple`         | `#a855f7` |
| **Pink**       | `--pink`           | `#ec4899` |
| **Teal**       | `--teal`           | `#2dd4bf` |

## Typography

### Font Families

*   **Primary**: `Inter`, `system-ui`, `-apple-system`, `Segoe UI`, `Roboto`, `sans-serif`
*   **Monospace**: `ui-monospace`, `SFMono-Regular`, `Menlo`, `Monaco`, `Consolas`, `monospace`

### Hierarchy

*   **Headings**: Bold (`700`), `Text Strong`.
*   **Body**: Regular (`400`), `Text`.
*   **Small/Meta**: Small size, `Muted`.

## Components

### Buttons

*   **Primary CTA**:
    *   Background: `var(--accent)`
    *   Text: `white`
    *   Border Radius: `9999px` (Pill shape)
    *   Hover: `var(--accent-strong)`, slight transform up.
*   **Secondary CTA**:
    *   Background: Transparent or low opacity white.
    *   Border: `var(--border)`
    *   Text: `var(--text)`
    *   Hover: Lighter background, `Text Strong`.

### Cards

*   Background: `var(--surface-alt)`
*   Border: `1px solid var(--border)`
*   Radius: `12px` or `1rem`
*   Hover: Border color changes to `var(--accent)`, slight lift (`transform: translateY(-5px)`).

### Status Badges

*   Small, pill-shaped (`border-radius: 99px`).
*   Uppercase, bold, small font size.
*   Active: Background `var(--accent)`, Text `var(--surface)`.
*   Disabled/Inactive: Background `rgba(255,255,255,0.1)`, Text `var(--muted)`.

## Layout

*   **Container**: Max-width `1200px` centered.
*   **Grid**: Responsive grids using `grid-template-columns: repeat(auto-fit, minmax(..., 1fr))`.
*   **Spacing**: Uses `rem` units (e.g., `1rem`, `2rem`, `4rem`).

## Accessibility Guidelines

*   **Contrast**: Ensure text passes WCAG AA standards against the dark background.
*   **Interactive Elements**:
    *   Must have `role="button"` or be `<button>`/`<a>`.
    *   Must be keyboard accessible (`tabindex="0"`).
    *   Must have visible focus states (`focus:ring`).
*   **Images**: All images must have `alt` text. Decorative images should use `aria-hidden="true"`.
