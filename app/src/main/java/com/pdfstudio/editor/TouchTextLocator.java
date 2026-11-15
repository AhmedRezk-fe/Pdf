package com.pdfstudio.editor;

import com.tom_roush.pdfbox.pdmodel.PDDocument;
import com.tom_roush.pdfbox.text.PDFTextStripper;
import com.tom_roush.pdfbox.text.TextPosition;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/** Extracts word/line hit areas in PDFTextStripper's top-left page coordinate system. */
public final class TouchTextLocator extends PDFTextStripper {
    public static class Line {
        public String text="";
        public float left=Float.MAX_VALUE, top=Float.MAX_VALUE, right=0, bottom=0;
        public boolean contains(float x,float y) {
            return x>=left-10 && x<=right+10 && y>=top-10 && y<=bottom+10;
        }
    }
    private final List<Line> lines=new ArrayList<>();
    private TouchTextLocator() throws IOException { super(); setSortByPosition(true); }
    @Override protected void writeString(String text, List<TextPosition> positions) throws IOException {
        if (positions == null || positions.isEmpty()) return;
        Line current=null;
        for(TextPosition p:positions) {
            String unicode=p.getUnicode();
            if(unicode==null || unicode.length()==0) continue;
            float x=p.getXDirAdj(), y=p.getYDirAdj();
            if(current==null || Math.abs(y-(current.bottom - 0.2f))>Math.max(4,p.getHeightDir()*1.3f)) {
                current=new Line();lines.add(current);
            }
            current.text+=unicode;
            current.left=Math.min(current.left,x);
            current.top=Math.min(current.top,y);
            current.right=Math.max(current.right,x+p.getWidthDirAdj());
            current.bottom=Math.max(current.bottom,y+p.getHeightDir());
        }
    }
    public static List<Line> extract(PDDocument doc, int pageIndex) throws IOException {
        TouchTextLocator finder=new TouchTextLocator();
        finder.setStartPage(pageIndex+1);finder.setEndPage(pageIndex+1);
        finder.getText(doc);
        return finder.lines;
    }
    public static Line find(List<Line> lines,float x,float y) {
        for(Line l:lines) if(l.contains(x,y))return l;
        return null;
    }
}
