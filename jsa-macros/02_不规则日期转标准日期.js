/**
 * 【JSA 宏】不规则日期转标准日期（ET 表格）
 * 支持：2026.9.8 / 2026-9-8 / 26/9/8 / 2026年9月8日 等
 * 用法：选中日期所在区域 → 运行 NormalizeDates()
 */
function NormalizeDates() {
  var sel = Application.Selection;
  if (!sel || sel.Cells.Count === 0) { alert("请先选中日期区域"); return; }
  var ws = Application.ActiveSheet;
  var n = 0;
  for (var a = 1; a <= sel.Areas.Count; a++) {
    var area = sel.Areas.Item(a);
    for (var r = 1; r <= area.Rows.Count; r++) {
      for (var c = 1; c <= area.Columns.Count; c++) {
        var cell = ws_Cell(area, r, c);
        var v = cell.Value2;
        if (typeof v !== "string") continue;
        var m = String(v).trim().match(/^(\d{2,4})[.\/\-年](\d{1,2})[.\/\-月](\d{1,2})日?$/);
        if (!m) continue;
        var y = parseInt(m[1], 10);
        if (y < 100) y += 2000;
        var mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
        if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
        var dt = new Date(y, mo - 1, d);
        if (isNaN(dt.getTime())) continue;
        cell.Value2 = dt;
        cell.NumberFormatLocal = "yyyy/m/d";
        n++;
      }
    }
  }
  alert("已转换 " + n + " 个日期");
}

function ws_Cell(area, r, c) {
  try { return area.Cells.Item(r, c); } catch (e) { return area.Item(r, c); }
}
