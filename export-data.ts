export class ExportData {
    position: number;

    origStringLogDate: string | null = null;
    origStringLogTime: string | null = null;
    origStringStackID: string | null = null;
    origStringExpID: string | null = null;
    origStringSiteID: string | null = null;

    logDateTime: Date | null = null;
    stackID: number | null = null;
    expID: number | null = null;
    siteID: number | null = null;
    comment: string | null = null;

    constructor(position: number) {
      this.position = position;
    }

    isEmpty(): boolean {
      return (
        !this.logDateTime &&
        !this.stackID &&
        !this.expID &&
        !this.siteID &&
        !this.comment
      );
    }

    isComplete(): boolean {
      return (
        !!this.logDateTime &&
        !!this.stackID &&
        !!this.expID &&
        !!this.siteID
      );
    }

    isInvalid(): boolean {
      return (
        (!!this.origStringLogDate && !this.logDateTime) ||
        (!!this.origStringLogTime && !this.logDateTime) ||
        (!!this.origStringStackID && !this.stackID) ||
        (!!this.origStringExpID && !this.expID) ||
        (!!this.origStringSiteID && !this.siteID)
      );
    }
  }