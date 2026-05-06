from pathlib import Path
s = Path("app.js").read_text(errors="ignore")

# crude beautify: enough for grep/context recognition
for a,b in [
    (";",";\n"),
    ("{","{\n"),
    ("}","}\n"),
    (",function",",\nfunction"),
    ("!function","\n!function"),
    ("function ","\nfunction "),
    ("case\"", "\ncase\""),
    ("case'", "\ncase'"),
]:
    s = s.replace(a,b)

Path("app.pretty.js").write_text(s)
print("created app.pretty.js")
