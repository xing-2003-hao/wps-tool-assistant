/**
 * 【JSA 宏】提取唯一值（ET 表格）
 * 把选区中不重复的值提取到选区右侧一列
 * 用法：选中数据区域 → 运行 ExtractUniqueValues()
 */
function ExtractUniqueValues() {
  var sel = Application.Selection;
  if (!sel || sel.Cells.Count === 0) { alert("请先选中数据区域"); return; }
  var ws = Application.ActiveSheet;
  var seen = {}, out = [];
  for (var a = 1; a <= sel.Areas.Count; a++) {
    var area = sel.Areas.Item(a);
    for (var r = 1; r <= area.Rows.Count; r++) {
      for (var c = 1; c <= area.Columns.Count; c++) {
        var v = ws_Cell(area, r, c).Value2;
        if (v === null || v === undefined || v === "") continue;
        var key = String(v);
        if (!seen[key]) { seen[key] = true; out.push(v); }
      }
    }
  }
  if (out.length === 0) { alert("选区内没有可提取的数据"); return; }
  var startRow = sel.Row;
  var startCol = sel.Column + sel.Columns.Count + 1;
  for (var i = 0; i < out.length; i++) {
    ws.Cells.Item(startRow + i, startCol).Value2 = out[i];
  }
  alert("已提取 " + out.length + " 个唯一值（从第 " + startCol + " 列开始写入）");
}

function ws_Cell(area, r, c) {
  try { return area.Cells.Item(r, c); } catch (e) { return area.Item(r, c); }
}
