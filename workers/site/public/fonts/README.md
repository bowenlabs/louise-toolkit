# Self-hosted brand fonts

Latin-subset variable woff2 files served from our own Cloudflare edge, so the
public site (`src/styles/fonts.css`) never requests fonts from Google (#194).
Both are licensed under the SIL Open Font License 1.1 (see the `*-OFL.txt` files).

| File | Family | Axes kept | Size |
| --- | --- | --- | --- |
| `RobotoFlex-latin.woff2` | Roboto Flex | `wght` 100–1000, `wdth` 25–151% | ~55 KB |
| `JetBrainsMono-latin.woff2` | JetBrains Mono | `wght` 100–800 | ~39 KB |

Roboto Flex keeps only the two axes the design uses; the other 11 (`opsz`,
`GRAD`, `slnt`, `XOPQ`, `YOPQ`, `XTRA`, `YTUC`, `YTLC`, `YTAS`, `YTDE`, `YTFI`)
are instanced away, which is why the file is far smaller than Google's all-axis
latin block (~191 KB). The `wdth` axis is required — the landing's display type
uses `font-stretch: 125–140%`.

## Regenerating

Sources are the OFL originals from the [google/fonts](https://github.com/google/fonts)
repo. With `fonttools` + `brotli` installed (`pip install fonttools brotli`):

```sh
LATIN="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"

# Roboto Flex — drop the 11 unused axes, then subset to latin + woff2.
python -m fontTools.varLib.instancer "RobotoFlex[...all axes...].ttf" \
  opsz=14 GRAD=0 slnt=0 XOPQ=96 YOPQ=79 XTRA=468 YTUC=712 YTLC=514 YTAS=750 YTDE=-203 YTFI=738 \
  -o rf-2axis.ttf
python -m fontTools.subset rf-2axis.ttf --unicodes="$LATIN" --layout-features='*' \
  --flavor=woff2 --output-file=RobotoFlex-latin.woff2

# JetBrains Mono — keep the wght axis, subset to latin + woff2.
python -m fontTools.subset "JetBrainsMono[wght].ttf" --unicodes="$LATIN" --layout-features='*' \
  --flavor=woff2 --output-file=JetBrainsMono-latin.woff2
```
