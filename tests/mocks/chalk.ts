const passthrough = (value: string) => value;

const chalkMock: any = passthrough;

for (const method of [
	"blueBright",
	"greenBright",
	"yellowBright",
	"redBright",
	"cyanBright",
	"magentaBright",
	"cyan",
]) {
	chalkMock[method] = passthrough;
}

chalkMock.hex = () => passthrough;
chalkMock.bgHex = () => passthrough;

chalkMock.bold = {
	cyan: passthrough,
};

export default chalkMock;
