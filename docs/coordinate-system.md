# Coordinate system

## Canonical unit: the PDF point

```text
1 pt = 1/72 inch = 0.352777… mm
```

All stored geometry (sizes, positions, bleed, stroke widths, font sizes, bar heights) is in points.

Why points:

- **Print is physical.** A 50 mm tag is 50 mm whatever the screen or zoom. Pixels are a screen
  concept whose physical size depends on the device, so `width: 800px` means nothing to a press.
- **PDF user space is points.** The future PDF renderer can use stored values directly, with no
  conversion step where rounding could creep in.
- **One unit, no ambiguity.** Designers may think in mm, cm or inches; `displayUnit` records the
  preference, but conversion happens only at the edges (input and display).

## Conversions

`@smarttag/document-utils` provides tested helpers:

| Function                                         | Formula                                                 |
| ------------------------------------------------ | ------------------------------------------------------- |
| `mmToPt(mm)`                                     | `mm / 25.4 × 72`                                        |
| `cmToPt(cm)`                                     | `cm / 2.54 × 72`                                        |
| `inToPt(in)`                                     | `in × 72`                                               |
| `ptToMm(pt)` / `ptToCm` / `ptToIn`               | inverses                                                |
| `toPoints(value, unit)` / `fromPoints(pt, unit)` | generic dispatch                                        |
| `formatLength`, `formatDimensions`               | display with per-unit precision (mm: 2 dp, cm/in: 3 dp) |
| `ptToCssPx(pt, zoom)`                            | **screen only**: `pt × 96/72 × zoom`                    |

Dividing first keeps whole-inch values exact (25.4 mm → exactly 72 pt). Values are stored as
IEEE-754 doubles. Conversions themselves never round; display formatting rounds only what is shown.
Non-finite input throws instead of propagating `NaN` into geometry.

## Precision

Interactive editing derives geometry from floating-point transforms (zoom, pointer deltas, rotation
matrices). Unnormalized, a 17 pt edge comes back as `17.000000000000231` and repeated open/save
cycles drift. `document-utils/geometry-precision.ts` defines canonical precision for **values an
editing operation changes**:

| Quantity | Precision                          | Helper              | Physical meaning                                       |
| -------- | ---------------------------------- | ------------------- | ------------------------------------------------------ |
| Length   | 4 decimals of a point (0.0001 pt)  | `normalizeLength`   | ≈ 0.035 µm — far below platesetter resolution (≈ 6 µm) |
| Rotation | 4 decimals of a degree, `[0, 360)` | `normalizeRotation` | < 2 µm error across a 1 m edge                         |
| Opacity  | 4 decimals, clamped to `[0, 1]`    | `normalizeOpacity`  | —                                                      |

Rules:

- **Changed values are normalized; unchanged values keep their exact stored bits.** Values within
  half a rounding unit of the stored value (`LENGTH_EPSILON_PT` = 0.00005 pt,
  `ROTATION_EPSILON_DEG`) count as unchanged, so reading a canvas object back never rewrites
  geometry that was not edited (`applyFrameChange`, `reconcileObject`).
- Rotations compare on the circle (`359.99999` equals `0`); `-0` is stored as `0`.
- Exact numeric input from the properties panel is converted from the display unit to points once,
  then normalized — e.g. 12.5 mm is stored as `35.4331` pt.
- Zoom and pan are never applied to stored values; see [editor.md](editor.md#round-trip-integrity).
- The SVG serializer writes the same 4-decimal precision, so previews add no further rounding.
- Documents created by API clients or earlier phases are not rewritten on load; only edits normalize.

## Trim space

```text
            bleed box (x = −bleed.left)
   ┌─────────────────────────────────────┐
   │  trim box origin (0,0) ──▶ +x        │
   │   ┌───────────────────────────┐     │
   │   │ ┌───────────────────────┐ │     │
   │   │ │ safe area             │ │     │
   │   │ │                       │ │     │
   │   │ └───────────────────────┘ │     │
   │ +y│                           │     │
   │ ▼ └───────────────────────────┘     │
   └─────────────────────────────────────┘
```

- Origin `(0,0)` is the **top-left corner of the trim box**; +x right, +y down (like screens;
  the PDF renderer flips y).
- The bleed box extends to negative coordinates. Artwork there is printed and then cut off.
- `getTrimBox`, `getBleedBox`, `getSafeBox` and `getMarginBox` (in `document-schema`) derive the boxes.
- Object `x`/`y` is the top-left of the un-rotated frame. `rotation` is clockwise degrees about the
  frame centre. `getRotatedBounds` gives the axis-aligned bounds used by validation.

## Back sides

Dieline features (holes, slots, folds, perforations) are physical and go through the whole piece.
They are authored in **front-side** coordinates. For `BACK` pages, rendering mirrors them:

- `backSideFlip: HORIZONTAL` (turned over left-to-right): `x' = width − x`
- `backSideFlip: VERTICAL` (turned over top-to-bottom): `y' = height − y`

Artwork objects on the back page are authored in back-page coordinates as the viewer sees them.

## Screens

The designer canvas and previews convert points to pixels at the last moment:
`px = pt × (96 / 72) × zoom × devicePixelRatio`, applied only through the canvas viewport
transform (designer zoom range 10 %–800 %). At 100 % zoom, a 50 mm tag appears at roughly its
physical size on a correctly calibrated 96-dpi display. The designer displays and accepts values in
the document's `displayUnit` (mm, cm, in, pt) and nudges by 0.25 mm / 1 mm (0.01 in / 0.1 in;
1 pt / 10 pt).
