/**
 * 【JSA 宏】清除选中区域的换行符（ET 表格）
 * 场景：从网页/PDF 复制来的脏数据，单元格内含手动换行符
 * 用法：选中区域 → JS 宏编辑器运行 SelectionClearLineBreaks()
 */
function SelectionClearLineBreaks() {
  var sel = Application.Selection;
  if (!sel || sel.Cells.Count === 0) { alert("请先选中要处理的单元格区域"); return; }
  var n = 0;
  for (var a = 1; a <= sel.Areas.Count; a++) {
    var area = sel.Areas.Item(a);
    for (var r = 1; r <= area.Rows.Count; r++) {
      for (var c = 1; c <= area.Columns.Count; c++) {
        var cell = ws_Cell(area, r, c);
        var v = cell.Value2;
        if (typeof v === "string" && /[\r\n]/.test(v)) {
          cell.Value2 = v.replace(/[\r\n]+/g, "");
          n++;
        }
      }
    }
  }
  alert("已清除 " + n + " 个单元格内的换行符");
}

/* 工具函数：按区域内相对行列取单元格（兼容合并单元格场景） */
function ws_Cell(area, r, c) {
  try { return area.Cells.Item(r, c); } catch (e) { return area.Item(r, c); }
}
