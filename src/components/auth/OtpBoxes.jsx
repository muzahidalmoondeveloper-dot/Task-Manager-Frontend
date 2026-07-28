export default function OtpBoxes({ value, onChange, idPrefix = "otp" }) {
  const digits = value.split("").concat(Array(6).fill("")).slice(0, 6);

  function handleKey(e, i) {
    if (e.key === "Backspace") {
      const next = value.slice(0, i) + value.slice(i + 1);
      onChange(next);
      if (i > 0) document.getElementById(`${idPrefix}-${i - 1}`)?.focus();
      return;
    }
    if (/^\d$/.test(e.key)) {
      const next = (value.slice(0, i) + e.key + value.slice(i + 1)).slice(0, 6);
      onChange(next);
      if (i < 5) document.getElementById(`${idPrefix}-${i + 1}`)?.focus();
    }
  }

  function handlePaste(e) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted) {
      onChange(pasted);
      document.getElementById(`${idPrefix}-${Math.min(pasted.length, 5)}`)?.focus();
    }
    e.preventDefault();
  }

  return (
    <div className="flex gap-2" onPaste={handlePaste}>
      {digits.map((d, i) => (
        <input
          key={i}
          id={`${idPrefix}-${i}`}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={d}
          readOnly
          onKeyDown={(e) => handleKey(e, i)}
          onClick={() => document.getElementById(`${idPrefix}-${i}`)?.focus()}
          className={`h-12 w-12 rounded-xl border text-center text-lg font-bold text-slate-900 outline-none transition-all focus:border-teal-500 focus:ring-2 focus:ring-teal-100 ${
            d ? "border-teal-400 bg-teal-50" : "border-slate-200 bg-slate-50"
          }`}
        />
      ))}
    </div>
  );
}
