# RigReady Style Guide

## Color Palette

The application uses a modern black, white, and greyscale color scheme with minimal accent colors reserved for status indicators.

### Core Colors

| Variable | Value | Usage |
|----------|-------|-------|
| `--bg-primary` | `#0a0a0a` | Main background (near black) |
| `--bg-secondary` | `#141414` | Sidebar, cards |
| `--bg-tertiary` | `#1e1e1e` | Hover states, input backgrounds |
| `--bg-elevated` | `#282828` | Elevated elements, modals |

### Text Colors

| Variable | Value | Usage |
|----------|-------|-------|
| `--text-primary` | `#ffffff` | Primary text, headings |
| `--text-secondary` | `#a0a0a0` | Secondary text, descriptions |
| `--text-muted` | `#666666` | Disabled, placeholder text |

### Accent Colors

| Variable | Value | Usage |
|----------|-------|-------|
| `--accent-primary` | `#ffffff` | Primary actions, active states |
| `--accent-hover` | `#e0e0e0` | Hover state for primary actions |
| `--accent-success` | `#4ade80` | Success states, connected devices |
| `--accent-warning` | `#fbbf24` | Warning states, pending |
| `--accent-danger` | `#f87171` | Error states, disconnected |

### Border Colors

| Variable | Value | Usage |
|----------|-------|-------|
| `--border-color` | `#2a2a2a` | Subtle borders |
| `--border-light` | `#3a3a3a` | More visible borders |

### Shadows

| Variable | Value | Usage |
|----------|-------|-------|
| `--shadow` | `0 4px 12px rgba(0,0,0,0.5)` | Cards, modals |
| `--shadow-sm` | `0 2px 4px rgba(0,0,0,0.3)` | Buttons, small elements |

## Typography

- **Font Family**: 'Segoe UI', system-ui, -apple-system, sans-serif
- **Base Size**: 16px
- **Headings**: 600 weight
- **Body**: 400 weight

### Text Sizes

| Element | Size |
|---------|------|
| H1 (Logo) | 1.25rem |
| H2 (Section) | 1.5rem |
| Body | 1rem |
| Small | 0.85rem |
| Caption | 0.75rem |

## Components

### Buttons

- **Primary**: White background, black text (for main actions)
- **Secondary**: Dark background with border (for secondary actions)
- **Danger**: Red background (for destructive actions)

### Cards

- Background: `--bg-secondary`
- Border radius: 10px
- Padding: 20px
- Subtle shadow on hover

### Forms

- Input background: `--bg-tertiary`
- Border: 1px solid `--border-color`
- Focus: White border
- Border radius: 6px

## Design Principles

1. **Minimal Color**: Use greyscale for most UI, reserve color for status
2. **Clear Hierarchy**: Use size and weight for visual hierarchy
3. **Consistent Spacing**: 8px grid system
4. **Subtle Animations**: 0.2s transitions for hover/focus states
5. **High Contrast**: Ensure text is readable (WCAG AA minimum)
