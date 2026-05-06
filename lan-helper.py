from pathlib import Path
p = Path("/home/suz/code/github/PingPongGo-Android-Host/app/src/main/assets/www/index.html")
s = p.read_text(errors="ignore")
tags = '<script src="ppg-lan-patch.js"></script>\n<script src="ppg-lan-autojoin.js"></script>\n'
if "ppg-lan-patch.js" not in s:
    s = s.replace("</head>", tags + "</head>") if "</head>" in s else tags + s
p.write_text(s)
print("LAN scripts injected")
