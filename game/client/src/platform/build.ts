/** This bundle's build id (vite.config.mts: a content hash of the client's sources). The bridge stamps every snapshot
 * with the build it serves; when the two differ, the page is old and should offer Reload. */
export const clientBuild: string = __CLIENT_BUILD__;
