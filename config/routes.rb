Rails.application.routes.draw do
  root "presentations#index"

  resources :presentations do
    member do
      get :present
    end
  end

  get "up" => "rails/health#show", as: :rails_health_check
end
