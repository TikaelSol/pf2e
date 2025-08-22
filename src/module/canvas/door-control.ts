import type WallDocument from "@client/documents/wall.d.mts";
import type { Point } from "@common/_types.d.mts";
import * as R from "remeda";

export class DoorControlPF2e extends fc.containers.DoorControl {
    /** Require that a door is in reach for a player to operate it. */
    protected override _onMouseDown(
        event: PIXI.FederatedPointerEvent,
    ): Promise<WallDocument | undefined> | boolean | void {
        const wall = this.wall;
        const wallDoc = wall.document;
        const requiresReach = game.pf2e.settings.automation.reachEnforcement.has("doors");
        if (event.button !== 0 || !requiresReach || wallDoc.isOwner || !game.user.can("WALL_DOORS") || game.paused) {
            return super._onMouseDown(event);
        }
        const testPoints: Point[] = [
            { x: wallDoc.c[0], y: wallDoc.c[1] },
            { x: wallDoc.c[2], y: wallDoc.c[3] },
            this.center,
        ];
        const isInReach = R.unique(
            [canvas.tokens.controlled, game.user.character?.getActiveTokens(true, false) ?? []].flat(),
        ).some((token) => {
            const actor = token.actor;
            return (
                actor?.isOwner &&
                actor.isOfType("creature") &&
                testPoints.some((p) => token.distanceTo(p) <= actor.attributes.reach.manipulate)
            );
        });
        if (isInReach) return super._onMouseDown(event);
        else ui.notifications.warn("PF2E.Wall.Door.OutOfReach", { localize: true });
    }
}
