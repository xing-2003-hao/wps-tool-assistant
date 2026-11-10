/**
 * 【JSA 宏】两区域数据差异对比（ET 表格）
 * 用法：先选中第一块区域，按住 Ctrl 再选第二块（大小需一致）→ 运行 CompareTwoRanges()
 * 第一块不同的单元格标浅红，第二块不同的标浅黄
 */
function CompareTwoRanges() {
  var sel = Application.Selection;
  if (!sel || sel.Areas.Count !== 2) {
    alert("请选中两块区域：先选第一块，按住 Ctrl 再选第二块");
    return;
  }
  var areaA = sel.Areas.Item(1);
  var areaB = sel.Areas.Item(2);
  if (areaA.Cells.Count !== areaB.Cells.Count) {
    alert("两块区域大小不一致，无法逐格对比");
    return;
  }
  var LIGHT_RED = 255 + 199 * 256 + 206 * 65536;   // #C7CEFF 反序 BGR → 浅红
  var LIGHT_YELLOW = 204 + 231 * 256 + 255 * 65536; // 浅黄
  var ws = Application.ActiveSheet;
  var diff = 0;
  for (var r = 1; r <= areaA.Rows.Count; r++) {
    for (var c = 1; c <= areaA.Columns.Count; c++) {
      var va = ws_Cell(areaA, r, c).Value2;
      var vb = ws_Cell(areaB, r, c).Value2;
      var same = String(va == null ? "" : va) === String(vb == null ? "" : vb);
      var cellA = ws.Cells.Item(areaA.Row + r - 1, areaA.Column + c - 1);
      var cellB = ws.Cells.Item(areaB.Row + r - 1, areaB.Column + c - 1);
      if (same) {
        cellA.Interior.ColorIndex = -4142; // xlNone
        cellB.Interior.ColorIndex = -4142;
      } else {
        cellA.Interior.Color = LIGHT_RED;
        cellB.Interior.Color = LIGHT_YELLOW;
        diff++;
      }
    }
  }
  alert("对比完成，共 " + diff + " 处差异（浅红/浅黄标记）");
}

function ws_Cell(area, r, c) {
  try { return area.Cells.Item(r, c); } catch (e) { return area.Item(r, c); }
}
