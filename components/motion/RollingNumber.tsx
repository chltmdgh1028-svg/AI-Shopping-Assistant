import type { CSSProperties } from "react";

const digits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * Digits roll like an odometer: on first paint they roll up from 0, and when the value changes they
 * roll from the old digit to the new one. Only `transform` moves (see .roll-strip in globals.css).
 * Non-digits (₩ , . %) stay still. Columns are keyed from the right so a changing digit count
 * keeps the units column in place.
 */
export function RollingNumber({ text, className }: { text: string; className?: string }) {
  const chars = [...text];

  return (
    <span className={`rolling-number ${className ?? ""}`} aria-label={text} role="img">
      {chars.map((char, index) => {
        const fromRight = chars.length - index;
        if (!/\d/.test(char)) {
          return (
            <span key={`s${fromRight}`} className="roll-static" aria-hidden="true">
              {char}
            </span>
          );
        }
        return (
          <span key={`d${fromRight}`} className="roll-digit" aria-hidden="true" style={{ "--d": Number(char), "--i": fromRight } as CSSProperties}>
            <span className="roll-strip">
              {digits.map((digit) => (
                <span key={digit}>{digit}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
