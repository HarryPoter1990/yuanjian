export async function measure(page, selector) {
  return page.locator(selector).evaluateAll((nodes) =>
    nodes.map((node) => {
      const canvas = document.createElement('canvas'),
        ctx = canvas.getContext('2d');
      const rgba = (value) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = value;
        ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data];
      };
      const composite = (over, under) => {
        const a = over[3] / 255;
        return over
          .slice(0, 3)
          .map((value, index) => value * a + under[index] * (1 - a))
          .concat(255);
      };
      let background = [255, 255, 255, 255];
      const chain = [];
      for (let parent = node; parent; parent = parent.parentElement) chain.unshift(parent);
      for (const element of chain)
        background = composite(rgba(getComputedStyle(element).backgroundColor), background);
      const luminance = (value) =>
        value
          .slice(0, 3)
          .map((channel) => {
            const v = channel / 255;
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          })
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      const contrast = (color) => {
        const a = luminance(composite(rgba(color), background)),
          b = luminance(background);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT),
        colors = [];
      for (let text = walker.nextNode(); text; text = walker.nextNode())
        if (text.textContent.trim()) colors.push(getComputedStyle(text.parentElement).color);
      const style = getComputedStyle(node),
        rect = node.getBoundingClientRect();
      return {
        text: node.textContent,
        color: style.color,
        background: style.backgroundColor,
        contrast: Math.min(...colors.map(contrast)),
        visible: rect.width > 0 && rect.height > 0,
      };
    }),
  );
}
