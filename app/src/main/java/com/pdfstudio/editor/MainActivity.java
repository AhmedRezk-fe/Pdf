package com.pdfstudio.editor;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader;
import com.tom_roush.pdfbox.pdmodel.PDDocument;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.List;

public final class MainActivity extends Activity {
    private static final int OPEN=101, SAVE=102;
    private File workingFile;
    private int currentPage=0;
    private ImageView preview;
    private TextView status;
    private String selectedText = null;
    private List<TouchTextLocator.Line> textLines = new java.util.ArrayList<>();
    private float tapX, tapY;
    private PdfRenderer renderer;
    private ParcelFileDescriptor descriptor;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        PDFBoxResourceLoader.init(getApplicationContext());
        getWindow().getDecorView().setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(18,18,18,18);
        setContentView(root);
        TextView title = new TextView(this); title.setText("PDF Studio — Android Alpha"); title.setTextSize(22); root.addView(title);
        Button open = button("اختيار ملف PDF", root); open.setOnClickListener(v -> {
            Intent it=new Intent(Intent.ACTION_OPEN_DOCUMENT);
            it.addCategory(Intent.CATEGORY_OPENABLE); it.setType("application/pdf"); startActivityForResult(it,OPEN);
        });
        LinearLayout nav = new LinearLayout(this); nav.setGravity(Gravity.CENTER); root.addView(nav);
        Button prev=button("◀ السابقة",nav), next=button("التالية ▶",nav);
        prev.setOnClickListener(v -> { if(currentPage>0) { currentPage--; render(); } });
        next.setOnClickListener(v -> { if(renderer!=null && currentPage+1<renderer.getPageCount()) {currentPage++; render();} });
        status=new TextView(this); status.setText("اختر ملف PDF للبدء. التعديل لا يغيّر الخط الأصلي تلقائيًا."); status.setTextSize(13); root.addView(status);
        ScrollView scroll=new ScrollView(this); root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
        preview=new ImageView(this); preview.setAdjustViewBounds(true); scroll.addView(preview);
        preview.setOnTouchListener((v,event) -> {
            if(event.getActionMasked()==MotionEvent.ACTION_DOWN){
                tapX=event.getX();tapY=event.getY();
            }
            return false;
        });
        preview.setOnClickListener(v -> selectAt(tapX,tapY));
        preview.setOnLongClickListener(v -> {selectAt(tapX,tapY);return true;});
        TextView hint=new TextView(this);
        hint.setText("المس سطرًا في الصفحة أو اضغط مطولًا لفتح Copy / Edit / Delete / Center / Left / Right. التعديل غير المدعوم يُرفض بدون تغيير الخط.");
        root.addView(hint);
        Button save=button("حفظ نسخة PDF",root); save.setOnClickListener(v -> {
            if(workingFile==null){notice("اختار ملف الأول");return;}
            Intent it=new Intent(Intent.ACTION_CREATE_DOCUMENT);it.setType("application/pdf");it.addCategory(Intent.CATEGORY_OPENABLE);
            it.putExtra(Intent.EXTRA_TITLE,"edited-document.pdf");startActivityForResult(it,SAVE);
        });
    }
    private Button button(String label,LinearLayout parent) {
        Button b=new Button(this);b.setText(label);parent.addView(b, parent.getOrientation()==LinearLayout.HORIZONTAL ? new LinearLayout.LayoutParams(0,-2,1) : new LinearLayout.LayoutParams(-1,-2));return b;
    }
    private void notice(String message) {status.setText(message);Toast.makeText(this,message,Toast.LENGTH_LONG).show();}
    @Override protected void onActivityResult(int request,int result,Intent data) {
        super.onActivityResult(request,result,data);
        if(result!=RESULT_OK || data==null || data.getData()==null)return;
        Uri uri=data.getData();
        try {
            if(request==OPEN){
                File dest=new File(getCacheDir(),"working.pdf");
                try(InputStream in=getContentResolver().openInputStream(uri);FileOutputStream out=new FileOutputStream(dest)){
                    byte[] buf=new byte[8192];int n;while((n=in.read(buf))!=-1)out.write(buf,0,n);
                }
                try(PDDocument check=PDDocument.load(dest)) {if(check.isEncrypted())throw new Exception("Encrypted PDF");}
                workingFile=dest; currentPage=0; reopen(); notice("تم فتح الملف محليًا، بدون رفعه لسيرفر");
            } else if(request==SAVE && workingFile!=null){
                try(FileInputStream in=new FileInputStream(workingFile);java.io.OutputStream out=getContentResolver().openOutputStream(uri)){
                    byte[] buf=new byte[8192];int n;while((n=in.read(buf))!=-1)out.write(buf,0,n);
                }
                notice("تم حفظ النسخة المعدلة");
            }
        }catch(Exception e){notice("تعذر تنفيذ العملية: "+e.getMessage());}
    }
    private void closeRenderer(){
        try{if(renderer!=null)renderer.close();}catch(Exception ignored){} renderer=null;
        try{if(descriptor!=null)descriptor.close();}catch(Exception ignored){} descriptor=null;
    }
    private void reopen() throws Exception{
        closeRenderer();descriptor=ParcelFileDescriptor.open(workingFile,ParcelFileDescriptor.MODE_READ_ONLY);
        renderer=new PdfRenderer(descriptor);render();
    }
    private void render(){
        if(renderer==null)return;
        try(PdfRenderer.Page pg=renderer.openPage(currentPage)){
            int w=Math.min(1300,Math.max(700,pg.getWidth()*2));
            int h=Math.round(w*((float)pg.getHeight()/pg.getWidth()));
            Bitmap bm=Bitmap.createBitmap(w,h,Bitmap.Config.ARGB_8888);
            bm.eraseColor(android.graphics.Color.WHITE);
            pg.render(bm,null,null,PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
            preview.setImageBitmap(bm);
            try(PDDocument doc=PDDocument.load(workingFile)) {
                textLines=TouchTextLocator.extract(doc,currentPage);
            } catch(Exception e) {textLines=new java.util.ArrayList<>();}

        }catch(Exception e){notice(e.getMessage());}
    }
    private void selectAt(float x,float y) {
        if(renderer==null || preview.getDrawable()==null)return;
        float iw=preview.getDrawable().getIntrinsicWidth();
        float ih=preview.getDrawable().getIntrinsicHeight();
        float scale=Math.min((float)preview.getWidth()/iw,(float)preview.getHeight()/ih);
        float left=(preview.getWidth()-iw*scale)/2f;
        float top=(preview.getHeight()-ih*scale)/2f;
        float px=(x-left)/scale, py=(y-top)/scale;
        if(px<0 || py<0 || px>iw || py>ih) return;
        try(PdfRenderer.Page page=renderer.openPage(currentPage)) {
            float pdfX=px*page.getWidth()/iw, pdfY=py*page.getHeight()/ih;
            TouchTextLocator.Line line=TouchTextLocator.find(textLines,pdfX,pdfY);
            if(line==null){notice("لا يوجد نص قابل للتحديد هنا. قد تكون الصفحة صورة أو النص غير قابل للاستخراج.");return;}
            selectedText=line.text;
            showActions(selectedText);
        } catch(Exception e) {notice("تعذر تحديد النص: "+e.getMessage());}
    }
    private void showActions(String selected) {
        final String[] actions={"Copy","Edit","Delete","Center","Right","Left"};
        new AlertDialog.Builder(this)
            .setTitle(selected.length()>110 ? selected.substring(0,110)+"…" : selected)
            .setItems(actions,(dialog,which) -> {
                switch(which){
                    case 0:
                        ((ClipboardManager)getSystemService(Context.CLIPBOARD_SERVICE))
                            .setPrimaryClip(ClipData.newPlainText("PDF text",selected));
                        notice("تم نسخ النص");break;
                    case 1: showEditDialog(selected);break;
                    case 2:
                        new AlertDialog.Builder(this).setTitle("حذف النص المحدد؟")
                            .setMessage("سيتم حذف النص فقط إذا أمكن الحفاظ على بقية المحتوى والخط الأصلي.")
                            .setPositiveButton("حذف",(d,w)->modify(selected,"","replace"))
                            .setNegativeButton("إلغاء",null).show();
                        break;
                    case 3: modify(selected,"","center");break;
                    case 4: modify(selected,"","right");break;
                    case 5: modify(selected,"","left");break;
                }
            }).show();
    }
    private void showEditDialog(String original) {
        EditText editor=new EditText(this);editor.setText(original);editor.setTextSize(18);
        editor.setMinLines(2); editor.setSelectAllOnFocus(false);
        LinearLayout holder=new LinearLayout(this);holder.setPadding(36,12,36,12);holder.addView(editor);
        new AlertDialog.Builder(this).setTitle("Edit — تعديل النص بنفس الخط")
            .setView(holder)
            .setPositiveButton("حفظ التعديل",(d,w)->modify(original,editor.getText().toString(),"replace"))
            .setNegativeButton("إلغاء",null).show();
    }
    private void modify(String original,String next,String action){
        if(workingFile==null){notice("اختار ملف PDF الأول");return;}
        try {
            PdfSafeEditor.Result result;
            // Close the rendering file handle before writing a replacement.
            closeRenderer();
            try(PDDocument doc=PDDocument.load(workingFile)){
                result=action.equals("replace")?PdfSafeEditor.replaceExact(doc,currentPage,original,next):
                    PdfSafeEditor.alignSingleLine(doc,currentPage,original,action);
                if(result.changed){
                    File tmp=new File(getCacheDir(),"pending.pdf");doc.save(tmp);
                    java.nio.file.Files.move(tmp.toPath(),workingFile.toPath(),java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                }
            }
            reopen();
            notice(result.message);
        }catch(Exception e){
            try{reopen();}catch(Exception ignored){}
            notice("لم يتم التعديل: "+e.getMessage());
        }
    }
    @Override protected void onDestroy(){closeRenderer();super.onDestroy();}
}
