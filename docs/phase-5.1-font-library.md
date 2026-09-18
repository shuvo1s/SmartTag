# Phase 5.1 — Enterprise Font Library

Phase 5.1 adds an organization-scoped administration UI for loading and reviewing production fonts
without changing the canonical document model or the existing font registry contract.

## What is implemented

- `Administration → Font library`
- TTF, OTF, WOFF and WOFF2 upload through the existing audited `POST /assets` font path
- Multi-file and folder selection for large font collections
- Four concurrent uploads so large libraries do not overload the API
- Client-side SHA-256 duplicate detection against the organization registry
- Server-side font inspection remains authoritative (`fontkit`)
- Search by family, style, PostScript name, filename and format
- Family grouping with weight/style faces
- Embedding-rights filter and restricted-font visibility
- Glyph-count and format metadata
- Exact-font preview that downloads only the selected font file
- Pagination at 50 families per page so 1,000+ font libraries remain usable
- Upload progress with uploaded/duplicate/rejected counts and rejection reasons

No database migration is required. Fonts continue to be immutable `FONT` assets with `font_faces`
metadata. Existing templates continue to reference fonts by `fontAssetId`.

## Large library workflow

For a library with hundreds or thousands of fonts:

1. Open **Administration → Font library**.
2. Use **Choose folder** and select a folder containing static font files.
3. SmartTag uploads four files at a time.
4. Exact duplicate files already in the registry are skipped before upload.
5. The API validates the actual file contents, rejects unsupported/corrupt files and registers each
   valid face in the existing font registry.
6. Search/filter the resulting library and click a face to load an exact-file browser preview.
7. Re-open an already-open Designer session after a large import so it receives a fresh registry
   snapshot immediately.

## Safety and limitations

- Variable fonts are intentionally refused in the current renderer contract. Upload static instances.
- TTC/OTC font collections are refused. Export/upload each face separately.
- ZIP archives are not expanded by the web tier in this release. Folder selection gives the same
  large-library workflow without introducing archive extraction/bomb risk.
- `RESTRICTED` embedding rights are surfaced prominently. Phase 6 production rendering is expected
  to enforce the recorded embedding permission when producing PDF artifacts.
- Browser previews and Designer canvases load exact font files on demand; fonts are not installed in
  the VPS operating system and are not bulk-downloaded when the library page opens.
- The server's configured `ASSET_MAX_UPLOAD_BYTES` remains the per-file upload limit.

## Deployment

This phase changes only the web application. There are no migrations and no new environment
variables. After tests/build pass, rebuild/redeploy `SmartTag App` from
`deploy/phase-5-dokploy`. API and Worker do not need a configuration change for this phase.
