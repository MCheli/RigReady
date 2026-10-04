# Binding guides

A binding guide tells someone who does not know an aircraft what matters: every important
action in plain language, what it does and when you use it, whether it belongs on the
stick, throttle or pedals, a panel, or can stay on the keyboard, grouped into three
priority tiers, with a plan per kind of device. RigReady's Binding guide page and its
walkthrough are built from these files. They need no AI key.

One YAML file per aircraft, named after DCS's input profile id (the folder name under
`Saved Games\DCS\Config\Input`, for example `FA-18C_hornet.yaml`). To add an aircraft,
copy one of the existing files and change it; nothing else needs to change.

## Format

```yaml
format: 1                       # always 1 for now
aircraft:
  id: FA-18C_hornet             # DCS's input profile id (case does not matter)
  name: F/A-18C Hornet          # shown to the user
summary: >-                     # two or three sentences: how to approach this aircraft
  ...
sources:                        # where the knowledge comes from, in plain words
  - ...
roles:                          # the plan per kind of device; any of these six
  stick:    { summary: ..., items: [pitch-roll, trigger, ...] }   # item ids, in priority order
  throttle: { summary: ..., items: [...] }
  pedals:   { summary: ..., items: [...] }
  mfd:      { summary: ..., items: [...] }
  panel:    { summary: ..., items: [...] }
  keyboard: { summary: ..., items: [...] }
items:
  - id: sensor-control          # lower-case letters, digits and dashes; unique in the file
    title: Sensor control switch
    tier: must                  # must (to fly and fight) | should | nice
    place: hotas                # hotas | panel | keyboard: where it belongs
    role: stick                 # stick | throttle | pedals | mfd | panel | keyboard
    need: all                   # all (default): every action should be bound
                                # any: one of them is enough (an axis OR two buttons)
    what: What it does, for someone who does not know the aircraft.
    when: When you use it.
    note: Optional tip shown in the walkthrough.
    actions:                    # DCS's own action names, exactly as in its controls screen
      - { name: Sensor Control Switch - Fwd, label: 'Sensor select: HUD' }   # label: plain language
      - re: '^Left MDI PB ([1-9]|1[0-9]|20)$'   # or a regular expression matching names
```

Rules the loader enforces (a shipped file that breaks one fails the tests):

- Unknown fields are refused, so a typo is caught rather than ignored.
- Every id in `roles` must be an item of the file, and every item should appear in a plan.
- Every `name` and `re` must match at least one action in DCS's default input files for the
  aircraft (`src/features/ai-assist/core/pack.test.ts` checks the shipped guides against the
  recorded DCS install).
- Text is plain: no HTML or Markdown is rendered.

DCS's own name is always shown next to the plain label, so a user can find the action in
DCS's controls screen.

## Guides drafted by AI

For an aircraft without a guide, a user with an Anthropic API key can have one drafted. It
is written in this format to `<RigReady data folder>\ai-assist\guides\<aircraft id>.yaml`,
carries a `drafted: { by, at }` field, and is marked as drafted by AI wherever it is shown.
Every action in it was checked against the aircraft's real action list, but nobody checked
the advice. A drafted guide that has been reviewed by someone who knows the aircraft is a
good starting point for a new file here (remove the `drafted` field).
