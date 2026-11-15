package com.pdfstudio.editor;

import com.tom_roush.pdfbox.contentstream.operator.Operator;
import com.tom_roush.pdfbox.cos.COSName;
import com.tom_roush.pdfbox.cos.COSNumber;
import com.tom_roush.pdfbox.cos.COSFloat;
import com.tom_roush.pdfbox.cos.COSString;
import com.tom_roush.pdfbox.pdfparser.PDFStreamParser;
import com.tom_roush.pdfbox.pdfwriter.ContentStreamWriter;
import com.tom_roush.pdfbox.pdmodel.PDDocument;
import com.tom_roush.pdfbox.pdmodel.PDPage;
import com.tom_roush.pdfbox.pdmodel.common.PDStream;
import com.tom_roush.pdfbox.pdmodel.font.PDFont;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/** Only edits isolated, unambiguous text runs using the original font.
 * Any unsupported edit is rejected, rather than silently substituted.
 */
public final class PdfSafeEditor {
    private PdfSafeEditor() {}
    public static final class Result {
        public final boolean changed;
        public final String message;
        Result(boolean changed, String message) { this.changed = changed; this.message = message; }
    }
    private static String decode(PDFont font, COSString s) throws IOException {
        if (font == null) throw new IOException("Missing active font");
        ByteArrayInputStream input = new ByteArrayInputStream(s.getBytes());
        StringBuilder builder = new StringBuilder();
        while (input.available() > 0) {
            int code = font.readCode(input);
            String ch = font.toUnicode(code);
            if (ch == null) throw new IOException("Font does not expose Unicode mapping");
            builder.append(ch);
        }
        return builder.toString();
    }
    public static Result replaceExact(PDDocument doc, int pageNumber, String original, String replacement) throws IOException {
        if (original == null || original.isEmpty()) return new Result(false, "Enter the exact text to change.");
        if (replacement == null) replacement = "";
        PDPage page = doc.getPage(pageNumber);
        PDFStreamParser parser = new PDFStreamParser(page);
        parser.parse();
        List<Object> tokens = new ArrayList<>(parser.getTokens());
        PDFont activeFont = null;
        List<Integer> candidates = new ArrayList<>();
        List<PDFont> candidateFonts = new ArrayList<>();
        List<String> candidateTexts = new ArrayList<>();
        for (int i = 0; i < tokens.size(); i++) {
            Object item = tokens.get(i);
            if (!(item instanceof Operator)) continue;
            String op = ((Operator) item).getName();
            if (op.equals("Tf") && i >= 2 && tokens.get(i-2) instanceof COSName) {
                activeFont = page.getResources().getFont((COSName) tokens.get(i-2));
            }
            if (op.equals("Tj") && i >= 1 && tokens.get(i-1) instanceof COSString && activeFont != null) {
                COSString raw = (COSString) tokens.get(i-1);
                String value;
                try { value = decode(activeFont, raw); }
                catch (Exception unsupported) { continue; }
                if (value.contains(original)) {
                    candidates.add(i-1);
                    candidateFonts.add(activeFont);
                    candidateTexts.add(value);
                }
            }
        }
        if (candidates.size() != 1) {
            return new Result(false, candidates.isEmpty()
                ? "The text is not an editable isolated run. Nothing changed."
                : "Text appears multiple times. Nothing changed; select a more specific phrase.");
        }
        String before = candidateTexts.get(0);
        if (before.indexOf(original) != before.lastIndexOf(original))
            return new Result(false, "Phrase repeats within this run. Nothing changed.");
        String after = before.replace(original, replacement);
        PDFont font = candidateFonts.get(0);
        byte[] encoded;
        try {
            encoded = font.encode(after);
            if (!decode(font, new COSString(encoded)).equals(after))
                return new Result(false, "Original font cannot round-trip new text. Nothing changed.");
        } catch (Exception ex) {
            return new Result(false, "Original font cannot encode replacement. Nothing changed.");
        }
        tokens.set(candidates.get(0), new COSString(encoded));
        ByteArrayOutputStream memory = new ByteArrayOutputStream();
        new ContentStreamWriter(memory).writeTokens(tokens);
        PDStream newContent = new PDStream(doc);
        try (OutputStream output = newContent.createOutputStream()) { output.write(memory.toByteArray()); }
        page.setContents(newContent);
        return new Result(true, "Edited using the original embedded PDF font. Check the preview before saving.");
    }
    /** Only an isolated horizontal single line with explicit Tm is supported. */
    public static Result alignSingleLine(PDDocument doc, int pageNumber, String exactText, String alignment) throws IOException {
        if (exactText == null || exactText.trim().isEmpty()) return new Result(false, "Enter an exact line to align.");
        if (!alignment.equals("left") && !alignment.equals("center") && !alignment.equals("right"))
            return new Result(false, "Unknown alignment.");
        PDPage page = doc.getPage(pageNumber);
        PDFStreamParser parser = new PDFStreamParser(page);
        parser.parse();
        List<Object> tokens = new ArrayList<>(parser.getTokens());
        PDFont activeFont = null;
        float size = 0;
        int count = 0, target = -1;
        float desiredWidth = 0;
        for (int i = 0; i < tokens.size(); i++) {
            Object item = tokens.get(i);
            if (!(item instanceof Operator)) continue;
            String op = ((Operator)item).getName();
            if (op.equals("Tf") && i >= 2 && tokens.get(i-2) instanceof COSName && tokens.get(i-1) instanceof COSNumber) {
                activeFont = page.getResources().getFont((COSName)tokens.get(i-2));
                size = ((COSNumber)tokens.get(i-1)).floatValue();
            }
            if (op.equals("Tj") && i >= 1 && tokens.get(i-1) instanceof COSString && activeFont != null && size > 0) {
                String line;
                try { line = decode(activeFont, (COSString)tokens.get(i-1)); }
                catch(Exception e) { continue; }
                if (!line.equals(exactText)) continue;
                count++;
                int tm = -1;
                for (int j = i - 1; j >= Math.max(0,i-24); j--) {
                    Object prev = tokens.get(j);
                    if (prev instanceof Operator) {
                        String name = ((Operator)prev).getName();
                        if (name.equals("Tj") || name.equals("TJ") || name.equals("BT") || name.equals("Td") || name.equals("TD")) break;
                        if (name.equals("Tm")) { tm = j; break; }
                    }
                }
                if (tm < 6) continue;
                boolean valid = true;
                for(int j=tm-6;j<tm;j++) if (!(tokens.get(j) instanceof COSNumber)) valid=false;
                if (!valid) continue;
                float a = ((COSNumber)tokens.get(tm-6)).floatValue();
                float b = ((COSNumber)tokens.get(tm-5)).floatValue();
                float c = ((COSNumber)tokens.get(tm-4)).floatValue();
                float d = ((COSNumber)tokens.get(tm-3)).floatValue();
                if (Math.abs(a-1)>0.001 || Math.abs(b)>0.001 || Math.abs(c)>0.001 || Math.abs(d-1)>0.001) continue;
                target = tm - 2;
                desiredWidth = activeFont.getStringWidth(exactText) * size / 1000f;
            }
        }
        if(count != 1 || target < 0)
            return new Result(false, "Alignment requires one isolated horizontal line with an explicit text matrix. No changes made.");
        float pageWidth = page.getMediaBox().getWidth();
        float margin = 36;
        float x = alignment.equals("left") ? margin : alignment.equals("right") ? pageWidth - margin - desiredWidth : (pageWidth-desiredWidth)/2f;
        if (x < 0 || x + desiredWidth > pageWidth) return new Result(false,"Text does not fit within the page. Nothing changed.");
        tokens.set(target, new COSFloat(x));
        ByteArrayOutputStream memory = new ByteArrayOutputStream();
        new ContentStreamWriter(memory).writeTokens(tokens);
        PDStream newContent = new PDStream(doc);
        try (OutputStream output = newContent.createOutputStream()) { output.write(memory.toByteArray()); }
        page.setContents(newContent);
        return new Result(true, "Line aligned using its existing PDF font and size.");
    }
    /**
     * Atomic on-disk group operations: caller only saves the PDDocument if the
     * entire operation succeeds. No fallback fonts or paragraph reflow.
     */
    public static Result alignLines(PDDocument doc, int page, List<String> lines, String alignment) throws IOException {
        if (lines==null || lines.isEmpty()) return new Result(false, "No lines selected.");
        for (String line:lines) {
            Result result=alignSingleLine(doc,page,line,alignment);
            if(!result.changed) return new Result(false,
                "Paragraph alignment unavailable: "+result.message+" The PDF was not saved.");
        }
        return new Result(true,"Aligned "+lines.size()+" isolated lines using their original fonts. Check the preview.");
    }
    public static Result replaceLines(PDDocument doc,int page,List<String> originals,List<String> replacements) throws IOException {
        if(originals==null || replacements==null || originals.size()!=replacements.size())
            return new Result(false,"Changing the number of lines requires paragraph reflow, which is not supported safely.");
        if(originals.isEmpty())return new Result(false,"No lines selected.");
        for(int i=0;i<originals.size();i++) {
            if(originals.get(i).equals(replacements.get(i))) continue;
            Result result=replaceExact(doc,page,originals.get(i),replacements.get(i));
            if(!result.changed) return new Result(false,
                "Line "+(i+1)+" not editable with its original font: "+result.message+" No changes saved.");
        }
        return new Result(true,"Updated selected lines without substituting fonts; verify layout before exporting.");
    }

}
