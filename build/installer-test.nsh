; The installer smoke test's variant ("RigReady Test", npm run smoke:installer). It is the
; same installer with a data folder of its own, so that no test run can ever reach the
; data of a real RigReady on the same PC.
!define RIGREADY_DATA_FOLDER ".rigready-installer-test"
!include "${BUILD_RESOURCES_DIR}\installer.nsh"
