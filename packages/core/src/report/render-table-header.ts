export function renderTableHeader(hasData: boolean): string {
  const titles = ['#', 'Command', 'Result', 'Evidence', ...(hasData ? ['Data'] : [])];

  return `<tr>${titles.map((title) => `<th>${title}</th>`).join('')}</tr>`;
}
