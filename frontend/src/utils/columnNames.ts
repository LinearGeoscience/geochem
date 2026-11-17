/** `base` if free, else base_2, base_3... (the first free suffix). */
export function uniqueColumnName(base: string, isTaken: (name: string) => boolean): string {
    if (!isTaken(base)) return base;
    let k = 2;
    while (isTaken(`${base}_${k}`)) k++;
    return `${base}_${k}`;
}

/** Make each of `names` unique against `taken` and against each other. */
export function uniqueColumnNames(names: string[], taken: Set<string>): string[] {
    const used = new Set(taken);
    return names.map(n => {
        const u = uniqueColumnName(n, x => used.has(x));
        used.add(u);
        return u;
    });
}
