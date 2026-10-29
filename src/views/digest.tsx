import type { DigestResult } from '../digest/types.js';

export function DigestPage({ digest }: { digest: DigestResult }) {
  return (
    <>
      <h1>digest {digest.night}</h1>
      {digest.invalidLines > 0 && <p class="mute">{digest.invalidLines} invalid lines skipped</p>}
      {digest.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <div style="overflow-x:auto">
          <table>
            <thead>
              <tr>
                <th>job</th>
                <th>owner</th>
                <th>runs</th>
                <th>retries</th>
                <th>last status</th>
                <th>last error</th>
                <th>first time</th>
                <th>last time</th>
              </tr>
            </thead>
            <tbody>
              {digest.rows.map((row) => (
                <tr class={row.retries >= 3 || row.hasFailure ? 'warn' : undefined}>
                  <td>{row.job}</td>
                  <td>{row.owner ?? '—'}</td>
                  <td>{row.runs}</td>
                  <td>{row.retries}</td>
                  <td>{row.lastStatus}</td>
                  <td>{row.lastError ?? '—'}</td>
                  <td>{row.firstAt}</td>
                  <td>{row.lastAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
