package com.pdfstudio.editor;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.view.Gravity;
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

public final class MainActivity extends Activity {
    private static final int OPEN=101, SAVE=102;
    private File workingFile;
    private int currentPage=0;
    private ImageView preview;
    private TextView status;
    private EditText search, replacement;
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
        TextView hint=new TextView(this); hint.setText("تعديل آمن للنص الأصلي: اكتب العبارة كما تظهر في الـPDF. يتم رفض التعديل عند عدم دعم الخط الأصلي، بدل استبداله بخط مختلف."); root.addView(hint);
        search=new EditText(this); search.setSingleLine(true); search.setHint("النص الأصلي (أو السطر كاملًا للمحاذاة)"); root.addView(search);
        replacement=new EditText(this); replacement.setSingleLine(true); replacement.setHint("النص البديل — اتركه فارغًا للحذف"); root.addView(replacement);
        Button edit=button("تعديل / حذف النص بنفس الخط",root); edit.setOnClickListener(v -> modify("replace"));
        LinearLayout aligns=new LinearLayout(this); root.addView(aligns);
        Button left=button("Left",aligns),center=button("Center",aligns),right=button("Right",aligns);
        left.setOnClickListener(v -> modify("left")); center.setOnClickListener(v -> modify("center")); right.setOnClickListener(v -> modify("right"));
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
        }catch(Exception e){notice(e.getMessage());}
    }
    private void modify(String action){
        if(workingFile==null){notice("اختار ملف PDF الأول");return;}
        String original=search.getText().toString(), next=replacement.getText().toString();
        try {
            PdfSafeEditor.Result result;
            try(PDDocument doc=PDDocument.load(workingFile)){
                result=action.equals("replace")?PdfSafeEditor.replaceExact(doc,currentPage,original,next):
                    PdfSafeEditor.alignSingleLine(doc,currentPage,original,action);
                if(result.changed){
                    File tmp=new File(getCacheDir(),"pending.pdf");doc.save(tmp);
                    java.nio.file.Files.move(tmp.toPath(),workingFile.toPath(),java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                }
            }
            if(result.changed)reopen();
            notice(result.message);
        }catch(Exception e){notice("لم يتم التعديل: "+e.getMessage());}
    }
    @Override protected void onDestroy(){closeRenderer();super.onDestroy();}
}
