# PDF Studio Pro — Gemini source

React 18 + Vite + Tailwind + Capacitor 6. This project preserves the supplied Gemini editor UI, text-selection, image overlay, signature, highlighting, alignment and export functionality. The PDF.js worker is bundled locally instead of being loaded from a CDN.

## Build

Run `npm install`, `npm run build`, `npx cap add android`, `npx cap sync android`, and `cd android && ./gradlew assembleDebug` (requires Android SDK and JDK 17).

## Critical editing limitation

The provided Smart Text Editor **does not rewrite embedded PDF glyphs using their original fonts**. It overlays white rectangles and new rendered text images, often with Cairo/Arial. It may visibly change alignment, font and appearance, especially in Arabic PDFs or on nonwhite backgrounds. Always compare copies before sharing. This has not been fixed; the user-supplied UI and features are retained.
