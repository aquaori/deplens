export interface ProgressHandle {
	start(total: number, stepName: string): void;
	update(current: number, stepName: string): void;
	increment(stepName: string): void;
	setTotal(total: number): void;
	stop(): void;
}

function render(current: number, total: number, stepName: string): string {
	return `[progress] ${current}/${Math.max(total, 0)} ${stepName}`;
}

export function createProgress(enabled: boolean): ProgressHandle {
	let active = enabled;
	let total = 0;
	let current = 0;

	return {
		start(nextTotal: number, stepName: string) {
			if (!active) return;
			total = Math.max(0, nextTotal);
			current = 0;
			console.log(render(current, total, stepName));
		},
		update(nextCurrent: number, stepName: string) {
			if (!active) return;
			current = Math.max(0, nextCurrent);
			console.log(render(current, total, stepName));
		},
		increment(stepName: string) {
			if (!active) return;
			current += 1;
			console.log(render(current, total, stepName));
		},
		setTotal(nextTotal: number) {
			total = Math.max(0, nextTotal);
		},
		stop() {
			active = false;
		},
	};
}
