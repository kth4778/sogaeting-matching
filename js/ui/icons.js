// 아이콘: index.html의 SVG 스프라이트(<symbol id="i-이름">)를 가리킨다
export function icon(name, size = 20) {
  return `<svg class="i" width="${size}" height="${size}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}
