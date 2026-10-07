import { Fragment } from "react";

/** Allow line breaks after dots so hostnames wrap at label boundaries, not mid-word. */
function breakable(value: string) {
  const parts = value.split(".");
  return parts.map((part, i) => (
    <Fragment key={i}>
      {part}
      {i < parts.length - 1 && (
        <>
          .<wbr />
        </>
      )}
    </Fragment>
  ));
}

/** Record values, one per line, wrapping at spaces and dots (only splitting a token as a last resort). */
export function RecordValues({ values }: { values: string[] }) {
  return (
    <span className="r53-values">
      {values.map((v, i) => (
        <span key={i} className="r53-value-line">
          {breakable(v)}
        </span>
      ))}
    </span>
  );
}
