/**
 * 【JSA 宏】取消公式保留值（ET 表格）
 * 把选中区域的公式批量转为静态数值（保留计算结果）
 * 用法：选中区域 → 运行 KeepValuesOnly()
 * 提示：会覆盖公式，建议先另存备份
 */
function KeepValuesOnly() {
  var sel = Application.Selection;
  if (!sel || sel.Cells.Count === 0) { alert("请先选中区域"); return; }
  if (!confirm("将把选中区域的公式替换为计算结果，且不可撤销，继续？")) return;
  var n = 0;
  for (var a = 1; a <= sel.Areas.Count; a++) {
    var area = sel.Areas.Item(a);
    for (var r = 1; r <= area.Rows.Count; r++) {
      for (var c = 1; c <= area.Columns.Count; c++) {
        var cell = ws_Cell(area, r, c);
        try {
          if (cell.HasFormula) {
            cell.Value2 = cell.Value2; // 读取到的是计算结果，写回即成常量
            n++;
          }
        } catch (e) { /* 跳过无法写入的单元格 */ }
      }
    }
  }
  alert("已转换 " + n + " 个公式单元格为静态值");
}

function ws_Cell(area, r, c) {
  try { return area.Cells.Item(r, c); } catch (e) { return area.Item(r, c); }
}
