Rails.application.routes.draw do
  root "presentations#index"

  resources :presentations do
    collection do
      post :load_samples
      post :start
    end
    member do
      get :present
      patch :rename
      post :fork
    end
  end

  get "up" => "rails/health#show", as: :rails_health_check
end
