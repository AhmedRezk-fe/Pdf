# PDF Studio Android

## Current baseline: mobile touch editor (Alpha)

This repository is the **editable source project** for the Android APK.
The user-provided `PDF-Studio-Android-APK (2).zip` contains only `app-debug.apk`, not a distinct source project.
Inspection of its `classes3.dex` confirms the same application package `com.pdfstudio.editor` and application classes:
`MainActivity`, `PdfSafeEditor`, `TouchTextLocator`, including `showParagraphEditor`.
Keep these source files: deleting them and replacing them with an APK would make future modifications far harder.

### APK inspected (2026-11-15)

- Submitted APK SHA-256: `f5179b4c084eaf39a22e317ccc49c8827a770c3484045db53ecd6a2f3184fe12`
- ZIP container integrity check: passed
- Contains three DEX files, resource files and PDFBox assets
- Structural check only: **not** an Android device test; this does **not** prove text editing or font preservation works.

### Editing support and limitations

The UI supports touching a PDF text line, and selection of a range of extracted lines through a start/end control. It offers Edit, Delete, Copy and alignment commands.
The PDF editing backend is **experimental**: it only edits isolated, uniquely matching Tj text runs with original-font encoding support. It does **not** yet robustly modify mixed Arabic text spread across multiple PDF text operators, reliably preserve the layout when deleting text, or reflow paragraphs like Word. These operations must fail safely without writing partial edits.

### Build APK

From GitHub Actions, run the `Build Android APK` workflow. When successful, download the `PDF-Studio-Android-APK` artifact and extract `app-debug.apk`.

### Development policy

Treat this existing touch-based UI as the baseline; do not replace it with the old form-entry UI.
Never silently change an original PDF font. Compare rendered pages and verify unchanged elements on every edit.
