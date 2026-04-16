export type CliWriter = Pick<NodeJS.WriteStream, "write"> & {
  isTTY?: boolean;
  columns?: number;
};
