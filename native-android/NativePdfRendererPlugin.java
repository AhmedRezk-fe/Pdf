package com.pdfstudio.editorpro;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.os.ParcelFileDescriptor;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.ByteArrayOutputStream;

@CapacitorPlugin(name = "NativePdfRenderer")
public class NativePdfRendererPlugin extends Plugin {
    @PluginMethod
    public void renderPdf(PluginCall call) {
        String encoded = call.getString("base64");
        Integer index = call.getInt("pageIndex");
        if (encoded == null || index == null || index < 0) {
            call.reject("Invalid PDF or page index");
            return;
        }
        File temp = null;
        try {
            byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
            if (bytes.length > 35 * 1024 * 1024) {
                call.reject("PDF too large for native preview");
                return;
            }
            temp = File.createTempFile("pdfstudio-preview-", ".pdf", getContext().getCacheDir());
            try (FileOutputStream out = new FileOutputStream(temp)) { out.write(bytes); }
            try (ParcelFileDescriptor descriptor = ParcelFileDescriptor.open(temp, ParcelFileDescriptor.MODE_READ_ONLY);
                 PdfRenderer renderer = new PdfRenderer(descriptor)) {
                if (index >= renderer.getPageCount()) {
                    call.reject("Page index out of bounds");
                    return;
                }
                try (PdfRenderer.Page page = renderer.openPage(index)) {
                    float scale = Math.min(2.0f, 2800f / Math.max(page.getWidth(), page.getHeight()));
                    int width = Math.max(1, Math.round(page.getWidth() * scale));
                    int height = Math.max(1, Math.round(page.getHeight() * scale));
                    Bitmap image = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
                    try {
                        image.eraseColor(Color.WHITE);
                        page.render(image, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                        ByteArrayOutputStream png = new ByteArrayOutputStream();
                        if (!image.compress(Bitmap.CompressFormat.PNG, 100, png)) {
                            call.reject("Failed to create preview");
                            return;
                        }
                        JSObject result = new JSObject();
                        result.put("pngBase64", Base64.encodeToString(png.toByteArray(), Base64.NO_WRAP));
                        call.resolve(result);
                    } finally { image.recycle(); }
                }
            }
        } catch (Exception ex) {
            call.reject("Native PDF rendering failed: " + ex.getMessage());
        } finally {
            if (temp != null) temp.delete();
        }
    }
}
