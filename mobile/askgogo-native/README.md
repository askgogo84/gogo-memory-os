# AskGogo Native App

First native Android/iOS implementation of the approved AskGogo mobile design.

## Current milestone

- Expo + React Native app shell
- Home, Today, Memory, Organise and You tabs
- Floating Gogo chat sheet
- AskGogo cream/orange native design system
- Android internal APK CI build
- Existing web/Claude site remains untouched

## Run locally

```bash
cd mobile/askgogo-native
npm install
npx expo start
```

## Android preview APK

Every push to `mobile/native-app-v1` triggers `.github/workflows/mobile-apk-preview.yml`.
The workflow generates a native Android project, builds `app-debug.apk`, and uploads it as the artifact `AskGogo-Android-Preview`.

## Store build path

- Internal Android test: APK artifact
- Google Play: production AAB profile in `eas.json`
- iOS beta: TestFlight after Apple signing/App Store Connect is configured

## Next integration pass

1. Native sign-in/account linking with the existing AskGogo identity
2. Live Today data
3. Live semantic Memory
4. Tasks, Lists and Calendar CRUD
5. Native voice + camera/document capture
6. Push notifications and reminder actions
7. Learn with Gogo native player
8. Subscription/entitlement state
