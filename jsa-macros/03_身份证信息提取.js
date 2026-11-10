/**
 * 【JSA 宏】身份证信息提取（ET 表格）
 * 从选区文本中识别 18/15 位身份证号，在右侧写入：出生日期、性别、年龄
 * 用法：选中包含身份证号的列 → 运行 ExtractIDInfo()
 */
function ExtractIDInfo() {
  var sel = Application.Selection;
  if (!sel || sel.Cells.Count === 0) { alert("请先选中包含身份证号的区域"); return; }
  var ws = Application.ActiveSheet;
  var n = 0;
  for (var a = 1; a <= sel.Areas.Count; a++) {
    var area = sel.Areas.Item(a);
    for (var r = 1; r <= area.Rows.Count; r++) {
      for (var c = 1; c <= area.Columns.Count; c++) {
        var cell = ws_Cell(area, r, c);
        var text = String(cell.Value2 == null ? "" : cell.Value2).replace(/\s/g, "");
        var id = extractID(text);
        if (!id) continue;
        var info = parseID(id);
        if (!info) continue;
        var row = cell.Row, col = cell.Column;
        ws.Cells.Item(row, col + 1).Value2 = info.birth;
        ws.Cells.Item(row, col + 2).Value2 = info.gender;
        ws.Cells.Item(row, col + 3).Value2 = info.age;
        n++;
      }
    }
  }
  alert("已解析 " + n + " 个身份证号（结果写入右侧三列）");
}

function extractID(text) {
  var m18 = text.match(/\d{17}[\dXx]/);
  if (m18) return m18[0];
  var m15 = text.match(/\d{15}/);
  if (m15) return m15[0];
  return null;
}

function parseID(id) {
  var birth, genderBit;
  if (id.length === 18) {
    birth = id.substr(6, 4) + "-" + id.substr(10, 2) + "-" + id.substr(12, 2);
    genderBit = parseInt(id.charAt(16), 10);
  } else {
    birth = "19" + id.substr(6, 2) + "-" + id.substr(8, 2) + "-" + id.substr(10, 2);
    genderBit = parseInt(id.charAt(14), 10);
  }
  var gender = genderBit % 2 === 1 ? "男" : "女";
  var by = parseInt(birth.substr(0, 4), 10), bm = parseInt(birth.substr(5, 2), 10);
  var now = new Date();
  var age = now.getFullYear() - by;
  if (now.getMonth() + 1 < bm) age--;
  return { birth: birth, gender: gender, age: age };
}

function ws_Cell(area, r, c) {
  try { return area.Cells.Item(r, c); } catch (e) { return area.Item(r, c); }
}
