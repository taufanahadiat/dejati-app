import { Capacitor, registerPlugin } from "@capacitor/core";
const ReportFile = registerPlugin("ReportFile");
const loaded = new Map();
function script(path) {
  if (!loaded.has(path)) loaded.set(path, new Promise((resolve, reject) => {
    const element = document.createElement("script");
    element.src = path; element.onload = resolve;
    element.onerror = () => { loaded.delete(path); element.remove(); reject(new Error("Gagal memuat pembuat laporan.")); };
    document.head.append(element);
  }));
  return loaded.get(path);
}
const xml = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
export async function exportReport(format, rows, name, title) {
  let blob;
  let mimeType;
  if (format === "csv") {
    mimeType = "text/csv";
    blob = new Blob(['\uFEFF' + rows.map(row => row.map(value => `"${String(value ?? "").replace(/^[=+@-]/,"'$&").replaceAll('"','""')}"`).join(",")).join("\r\n")], { type: mimeType });
  } else if (format === "excel") {
    await script("/server-assets/plugins/jszip/jszip.min.js");
    const zip = new window.JSZip();
    zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
    zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    zip.file("xl/workbook.xml", '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="History Transaksi" sheetId="1" r:id="rId1"/></sheets></workbook>');
    zip.file("xl/_rels/workbook.xml.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
    zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="4" width="24" customWidth="1"/><col min="5" max="7" width="18" customWidth="1"/></cols><sheetData>${rows.map((row,i)=>`<row r="${i+1}">${row.map((value,j)=>`<c r="${String.fromCharCode(65+j)}${i+1}" ${typeof value === "number"?'t="n"':'t="inlineStr"'}>${typeof value === "number"?`<v>${value}</v>`:`<is><t xml:space="preserve">${xml(value)}</t></is>`}</c>`).join("")}</row>`).join("")}</sheetData></worksheet>`);
    mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    blob = await zip.generateAsync({ type:"blob",mimeType });
  } else {
    await script("/server-assets/plugins/pdfmake/pdfmake.min.js");
    await script("/server-assets/plugins/pdfmake/vfs_fonts.js");
    mimeType = "application/pdf";
    blob = await new Promise(resolve => window.pdfMake.createPdf({ pageOrientation:"landscape",defaultStyle:{fontSize:9},content:[{text:title,fontSize:14,margin:[0,0,0,12]},{table:{headerRows:1,widths:["*","*","*","*","*","*","*"],body:rows.map(row=>row.map(value=>String(value??"")))},layout:"lightHorizontalLines"}] }).getBlob(resolve));
  }
  const filename = `${name}.${format === "excel" ? "xlsx" : format}`;
  if (Capacitor.isNativePlatform()) {
    const data = await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.onerror=reject;reader.readAsDataURL(blob);});
    return ReportFile.save({ data,name:filename,mimeType });
  }
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement("a");anchor.href=url;anchor.download=filename;anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
