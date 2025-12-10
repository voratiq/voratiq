type ChalkFormatter = (text: string) => string;

function buildFormatter(openCode: number, closeCode: number): ChalkFormatter {
  return (text: string) => `\u001B[${openCode}m${text}\u001B[${closeCode}m`;
}

const chalkMock = {
  red: buildFormatter(31, 39),
  green: buildFormatter(32, 39),
  yellow: buildFormatter(33, 39),
  blue: buildFormatter(34, 39),
  magenta: buildFormatter(35, 39),
  cyan: buildFormatter(36, 39),
  gray: buildFormatter(90, 39),
};

export default chalkMock;
