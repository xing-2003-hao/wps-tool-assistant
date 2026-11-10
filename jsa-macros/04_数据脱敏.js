/**
 * 【JSA 宏】选区数据脱敏（ET 表格）
 * 自动识别：手机号（保留前3后4）、身份证（保留前6后4）、中文姓名（保留姓）
 * 用法：选中区域 → 运行 MaskSelection()
 */
function MaskSelection() {
  var sel = Application.Selection;
  if (!sel || sel.Cells.Count === 0) { alert("请先选中要脱敏的区域"); return; }
  var n = 0;
  for (var a = 1; a <= sel.Areas.Count; a++) {
    var area = sel.Areas.Item(a);
    for (var r = 1; r <= area.Rows.Count; r++) {
      for (var c = 1; c <= area.Columns.Count; c++) {
        var cell = ws_Cell(area, r, c);
        var v = cell.Value2;
        if (typeof v !== "string" || !v) continue;
        var masked = maskText(v);
        if (masked !== v) { cell.Value2 = masked; n++; }
      }
    }
  }
  alert("已脱敏 " + n + " 个单元格");
}

function maskText(text) {
  // 手机号
  var out = text.replace(/(1[3-9]\d)\d{4}(\d{4})/g, "$1****$2");
  // 18 位身份证
  out = out.replace(/(\d{6})\d{8}(\d{3}[\dXx])/g, "$1********$2");
  // 15 位身份证
  out = out.replace(/(\d{6})\d{6}(\d{3})/g, "$1******$2");
  // 纯中文姓名（2~4 个汉字，占整个单元格时）
  if (/^[\u4e00-\u9fa5]{2,4}$/.test(out.trim())) {
    var name = out.trim();
    out = name.charAt(0) + "*".repeat(name.length - 1);
  }
  return out;
}

function ws_Cell(area, r, c) {
  try { return area.Cells.Item(r, c); } catch (e) { return area.Item(r, c); }
}
