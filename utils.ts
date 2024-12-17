export function isNumber(value: string): boolean {
    return !isNaN(Number(value));
}

export function isInteger(value: string): boolean {
    const num = Number(value);
    return !isNaN(num) && Number.isInteger(num);
}