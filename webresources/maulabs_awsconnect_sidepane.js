var AwsConnect = window.AwsConnect || {};
(function () {
  var PANE_ID = "awsconnect_softphone";
  AwsConnect.openPane = function () {
    try {
      if (!window.Xrm || !Xrm.App || !Xrm.App.sidePanes) { return; }
      var existing = Xrm.App.sidePanes.getPane(PANE_ID);
      if (existing) { existing.select(); return; }
      Xrm.App.sidePanes.createPane({
        paneId: PANE_ID,
        title: "AWS Connect",
        canClose: true,
        width: 420,
        alwaysRender: true
      }).then(function (pane) {
        pane.navigate({ pageType: "webresource", webresourceName: "maulabs_awsconnect_softphone.html" });
      });
    } catch (e) { console.error("AwsConnect.openPane", e); }
  };
  AwsConnect.onAppLoad = function () {
    setTimeout(AwsConnect.openPane, 1500);
  };
})();
window.AwsConnect = AwsConnect;
