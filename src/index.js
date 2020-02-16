const path = require("path");

const defaultOptions = {
    debug: false
};

// These are the message identifiers
export const readCSVRequest = "ReadCSV-Request";
export const writeCSVRequest = "WriteCSV-Request";
export const readCSVResponse = "ReadCSV-Response";
export const writeCSVResponse = "WriteCSV-Response";

class CSV {
    constructor(options){
        this.options = defaultOptions;

        // log-related variables
        const logPrepend = "[secure-electron-read-write-csv:";
        this.mainLog = `${logPrepend}main]=>`;
        this.rendererLog = `${logPrepend}renderer]=>`;

        // Merge any options the user passed in
        if (typeof options !== "undefined") {
            this.options = Object.assign(this.options, options);
        }

        this.validSendChannels = [readCSVRequest, writeCSVRequest];
        this.validReceiveChannels = [readCSVResponse, writeCSVResponse];
    }

    preloadBindings(ipcRenderer){
        return {
            send: (channel, path, data) => {
                if (this.validSendChannels.includes(channel)) {
                    switch (channel) {
                        case readCSVRequest:
                            debug ? console.log(`${this.rendererLog} requesting to read csv data from path '${path}'.`) : null;

                            ipcRenderer.send(channel, {
                                path
                            });
                            break;
                        case writeCSVRequest:
                            debug ? console.log(`${this.rendererLog} requesting to write csv data to path '${path}'.`) : null;

                            ipcRenderer.send(channel, {
                                path,
                                data
                            });
                            break;
                        default:
                            break;
                    }
                }
            },
            onReceive: (channel, func) => {
                if (this.validReceiveChannels.includes(channel)) {

                    // Deliberately strip event as it includes "sender"
                    ipcRenderer.on(channel, (event, args) => {
                        if (debug) {
                            switch (channel) {
                                case readCSVResponse:
                                    console.log(`${this.rendererLog} received csv data from path '${args.path}'.`);
                                    break;
                                case writeCSVResponse:
                                    console.log(`${this.rendererLog} ${!args.success ? "un-" : ""}successfully wrote csv data to file '${args.path}'.`);
                                    break;
                                default:
                                    break;
                            }
                        }

                        func(args);
                    });
                }
            },
            clearRendererBindings: () => {
                // Clears all listeners
                debug ? console.log(`${this.rendererLog} clearing all ipcRenderer listeners.`) : null;

                for (var i = 0; i < this.validReceiveChannels.length; i++) {
                    ipcRenderer.removeAllListeners(this.validReceiveChannels[i]);
                }
            }
        };
    }

    mainBindings(ipcMain, browserWindow, fs){
                
        // Anytime the renderer process requests for a file read
        ipcMain.on(readCSVRequest, (IpcMainEvent, args) => {
            //debug ? console.log(`${this.mainLog} received a request to read from the key '${args.key}' from the given file '${path}'.`) : null;

            fs.readFile(args.path, (error, data) => {

                if (error) {

                    // File does not exist, so let's return
                    browserWindow.webContents.send(readCSVResponse, {
                        success: false,
                        path: args.path,
                        data: undefined
                    });
                    return;
                }

                let dataToRead = data;

                try {
                    if (encrypt) {
                        this.getIv(fs);

                        const decipher = crypto.createDecipheriv("aes-256-cbc", crypto.createHash("sha512").update(this.options.passkey).digest("base64").substr(0, 32), this.iv);
                        dataToRead = Buffer.concat([decipher.update(dataToRead), decipher.final()]);
                    }

                    if (minify) {
                        dataToRead = decode(dataToRead);
                    } else {
                        dataToRead = JSON.parse(dataToRead);
                    }
                } catch (error) {
                    throw `${this.mainLog} encountered error '${error}' when trying to read file '${path}'. This file is probably corrupted or has been tampered with. To fix this error, you may set "reset" to true in the options in your main process where you configure your store, or you can turn off your app, delete (recommended) or fix this file and restart your app to fix this issue.`;
                }

                this.fileData = dataToRead;

                debug ? console.log(`${this.mainLog} read the key '${args.key}' from file => '${dataToRead[args.key]}'.`) : null;
                browserWindow.webContents.send(readConfigResponse, {
                    success: true,
                    key: args.key,
                    value: dataToRead[args.key]
                });
            });
        });

        // Anytime the renderer process requests for a file write
        ipcMain.on(writeCSVRequest, (IpcMainEvent, args) => {

            // Wrapper function; since we call
            // this twice below
            let writeToFile = function () {
                if (typeof args.key !== "undefined" && typeof args.value !== "undefined") {
                    this.fileData[args.key] = args.value;
                }

                let dataToWrite = this.fileData;

                try {
                    if (minify) {
                        dataToWrite = encode(dataToWrite);
                    } else {
                        dataToWrite = JSON.stringify(dataToWrite);
                    }

                    if (encrypt) {
                        this.getIv(fs);

                        const cipher = crypto.createCipheriv("aes-256-cbc", crypto.createHash("sha512").update(this.options.passkey).digest("base64").substr(0, 32), this.iv);
                        dataToWrite = Buffer.concat([cipher.update(dataToWrite), cipher.final()]);
                    }
                } catch (error) {
                    throw `${this.mainLog} encountered error '${error}' when trying to write file '${path}'.`;
                }

                fs.writeFile(path, dataToWrite, (error) => {
                    debug ? console.log(`${this.mainLog} wrote "'${args.key}':'${args.value}'" to file '${path}'.`) : null;
                    browserWindow.webContents.send(writeConfigResponse, {
                        success: !error,
                        key: args.key
                    });
                });
            }.bind(this);


            // If we don't have any filedata saved yet,
            // let's pull out the latest data from file
            if (typeof this.fileData === "undefined") {
                fs.readFile(path, (error, data) => {

                    if (error) {

                        // File does not exist, so let's create a file
                        // and give it an empty/default value
                        if (error.code === "ENOENT") {
                            this.fileData = {};

                            writeToFile();
                            return;
                        } else {
                            throw `${this.mainLog} encountered error '${error}' when trying to read file '${path}'. This file is probably corrupted. To fix this error, you may set "reset" to true in the options in your main process where you configure your store, or you can turn off your app, delete (recommended) or fix this file and restart your app to fix this issue.`;
                        }
                    }

                    // Retrieve file contents
                    let dataInFile = data;
                    try {
                        if (typeof data !== "undefined") {
                            if (encrypt) {
                                this.getIv(fs);

                                const decipher = crypto.createDecipheriv("aes-256-cbc", crypto.createHash("sha512").update(this.options.passkey).digest("base64").substr(0, 32), this.iv);
                                dataInFile = Buffer.concat([decipher.update(dataInFile), decipher.final()]);
                            }

                            if (minify) {
                                dataInFile = decode(dataInFile);
                            } else {
                                dataInFile = JSON.parse(dataInFile);
                            }
                        }
                    } catch (error) {
                        throw `${this.mainLog} encountered error '${error}' when trying to read file '${path}'. This file is probably corrupted. To fix this error, you may set "reset" to true in the options in your main process where you configure your store, or you can turn off your app, delete (recommended) or fix this file and restart your app to fix this issue.`;
                    }

                    this.fileData = dataInFile;
                    writeToFile();
                });
            } else {
                writeToFile();
            }
        });
    }

    // Removes all bindings in the main process
    clearMainBindings(ipcMain){
        ipcMain.removeAllListeners(readCSVRequest);
        ipcMain.removeAllListeners(writeCSVRequest);
    }
}

export { CSV };