// Adapted from the user-provided oks71-tula-demo_3.zip, js/app.js (holoSVG).
(() => {
  var HOLO_CACHE = {};
  function holoSVG(sector) {
    if (HOLO_CACHE[sector]) return HOLO_CACHE[sector];
    function iso(x, y, z) { // изометрическая проекция
      return [60 + (x - y) * 0.866, 78 + (x + y) * 0.5 - z].map(function (v) { return Math.round(v * 10) / 10; });
    }
    function P(pts) { return pts.map(function (p, i) { return (i ? "L" : "M") + p[0] + " " + p[1]; }).join(" "); }
    function box(cx, cy, w, d, h, floors, cols) { // каркасный параллелепипед с сеткой окон
      var x0 = cx - w / 2, y0 = cy - d / 2, x1 = cx + w / 2, y1 = cy + d / 2;
      var A = iso(x0, y0, 0), B = iso(x1, y0, 0), C = iso(x1, y1, 0), Dd = iso(x0, y1, 0);
      var A2 = iso(x0, y0, h), B2 = iso(x1, y0, h), C2 = iso(x1, y1, h), D2 = iso(x0, y1, h);
      var d1 = "";
      d1 += P([A, B, C, Dd, A]) + " " + P([A2, B2, C2, D2, A2]);
      d1 += " " + P([A, A2]) + " " + P([B, B2]) + " " + P([C, C2]) + " " + P([Dd, D2]);
      // окна на двух видимых гранях
      for (var f2 = 1; f2 < floors; f2++) {
        var z = h * f2 / floors;
        d1 += " " + P([iso(x0, y1, z), iso(x1, y1, z)]) + " " + P([iso(x1, y0, z), iso(x1, y1, z)]);
      }
      for (var c2 = 1; c2 < cols; c2++) {
        d1 += " " + P([iso(x0 + w * c2 / cols, y1, 0), iso(x0 + w * c2 / cols, y1, h)]);
        d1 += " " + P([iso(x1, y0 + d * c2 / cols, 0), iso(x1, y0 + d * c2 / cols, h)]);
      }
      return d1;
    }
    var body = "";
    if (sector === "housing") {           // композиция референса: башня + два малых блока
      body = box(0, 0, 26, 26, 62, 8, 3) + " " + box(-30, 26, 24, 22, 22, 2, 2) + " " + box(30, 24, 22, 20, 26, 3, 2);
    } else if (sector === "edu") {        // длинный корпус школы + флагшток
      body = box(0, 6, 56, 24, 26, 3, 5) + " " + box(-2, -18, 20, 16, 34, 3, 2) +
        " " + P([iso(24, -8, 34), iso(24, -8, 56)]) + " " + P([iso(24, -8, 56), iso(34, -8, 51), iso(24, -8, 46)]);
    } else if (sector === "health") {     // корпус с крестом
      body = box(0, 4, 40, 26, 40, 4, 3) +
        " " + P([iso(-6, 17, 22), iso(6, 17, 22)]) + " " + P([iso(0, 17, 16), iso(0, 17, 28)]);
    } else if (sector === "sport") {      // арена: кольцо из сегментов
      var ring = "";
      for (var a = 0; a < 360; a += 20) {
        var r1 = 30, r2 = 38, ra = a * Math.PI / 180, rb = (a + 20) * Math.PI / 180;
        ring += " " + P([iso(r1 * Math.cos(ra), r1 * Math.sin(ra), 0), iso(r2 * Math.cos(ra), r2 * Math.sin(ra), 14),
                         iso(r2 * Math.cos(rb), r2 * Math.sin(rb), 14), iso(r1 * Math.cos(rb), r1 * Math.sin(rb), 0)]);
      }
      body = ring;
    } else if (sector === "infra") {      // блок с трубой
      body = box(0, 6, 44, 26, 24, 2, 4) + " " + box(16, -6, 10, 10, 58, 5, 1);
    } else {                              // культура: портик с колоннами
      body = box(0, 6, 50, 26, 30, 2, 1);
      for (var cx = -18; cx <= 18; cx += 12) body += " " + P([iso(cx, 19, 0), iso(cx, 19, 24)]);
      body += " " + P([iso(-25, 19, 24), iso(0, 19, 38), iso(25, 19, 24), iso(-25, 19, 24)]);
    }
    var svg = '<svg class="holo-svg" viewBox="0 0 120 96" xmlns="http://www.w3.org/2000/svg">' +
      '<path class="hl-glow" d="' + body + '"/><path class="hl-line" d="' + body + '"/></svg>';
    HOLO_CACHE[sector] = svg;
    return svg;
  }


  window.objectModelSVG = industry => holoSVG({
    'Образование':'edu', 'Здравоохранение':'health', 'Спорт':'sport',
    'Энергетика':'infra', 'ЖКХ':'infra', 'Жильё':'housing', 'Культура':'culture'
  }[industry] || 'culture');
})();
